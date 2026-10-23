-- Full automation v3: upload -> inference -> severity -> place name -> advisory -> provisional
-- publication -> SMS, with specialist accept/reject afterwards. See docs/full-automation-v3-20261023.md.

-- 1. Barangay polygons for coordinate -> place-name lookup (data in the next migration).
create table if not exists public.rg_barangay_boundaries(
  code text primary key references public.rg_locations(code),
  geometry extensions.geometry(MultiPolygon, 4326) not null,
  source text not null default 'PSGC 2023 via faeldon/philippines-json-maps (hires)'
);
create index if not exists rg_barangay_boundaries_geom on public.rg_barangay_boundaries using gist(geometry);
alter table public.rg_barangay_boundaries enable row level security;

-- 2. Automation state.
alter table public.rg_surveys
  add column if not exists auto_status text check (auto_status in ('pending','running','retry','done','failed')),
  add column if not exists auto_mode text not null default 'initial' check (auto_mode in ('initial','verify')),
  add column if not exists auto_attempts integer not null default 0,
  add column if not exists auto_next_at timestamptz,
  add column if not exists auto_error text,
  add column if not exists place jsonb,
  add column if not exists severity_detail jsonb,
  add column if not exists location_source text check (location_source in ('exif_median','manual_pin','none'));
create index if not exists rg_surveys_auto_queue on public.rg_surveys(auto_next_at)
  where auto_status in ('pending','retry','running');

alter table public.rg_bulletins
  add column if not exists verification_status text not null default 'verified'
    check (verification_status in ('unverified','verified','corrected','retracted')),
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references auth.users(id),
  add column if not exists auto_generated boolean not null default false,
  add column if not exists severity_detail jsonb,
  add column if not exists advisory_sources jsonb,
  add column if not exists place jsonb;

alter table public.rg_public_posts
  add column if not exists verification_status text not null default 'verified'
    check (verification_status in ('unverified','verified','corrected')),
  add column if not exists verified_at timestamptz,
  add column if not exists severity_detail jsonb,
  add column if not exists place jsonb;

alter table public.rg_finding_reviews
  add column if not exists reason text check (reason in ('healthy','other_disease','unclear','other')),
  add column if not exists note text check (note is null or length(note) <= 500);

alter table public.rg_campaigns
  add column if not exists kind text not null default 'advisory' check (kind in ('advisory','correction'));

-- 3. Pipeline step log, streamed to the admin monitor over Realtime.
create table if not exists public.rg_pipeline_steps(
  id bigint generated always as identity primary key,
  survey_id uuid not null references public.rg_surveys(id) on delete cascade,
  step text not null,
  status text not null check (status in ('running','done','skipped','failed')),
  detail jsonb not null default '{}'::jsonb,
  attempt integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists rg_pipeline_steps_survey on public.rg_pipeline_steps(survey_id, created_at desc);
alter table public.rg_pipeline_steps enable row level security;
drop policy if exists staff_read on public.rg_pipeline_steps;
create policy staff_read on public.rg_pipeline_steps for select to authenticated using ((select public.is_admin()));
do $$ begin
  begin alter publication supabase_realtime add table public.rg_pipeline_steps; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.rg_surveys; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.rg_processing_jobs; exception when duplicate_object then null; end;
end $$;

-- 4. Coordinates -> Barangay, Municipality/City, Province. Public: it only names places.
create or replace function public.rg_reverse_geocode(p_lat double precision, p_lng double precision)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare pt extensions.geometry; hit text; how text; distance double precision; b record; m record; p record;
begin
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    return jsonb_build_object('method','none');
  end if;
  pt := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326);
  select code into hit from public.rg_barangay_boundaries where extensions.st_covers(geometry, pt) limit 1;
  how := 'inside'; distance := 0;
  if hit is null then
    select code, extensions.st_distance(geometry::extensions.geography, pt::extensions.geography)
      into hit, distance from public.rg_barangay_boundaries
      where extensions.st_dwithin(geometry::extensions.geography, pt::extensions.geography, 500)
      order by geometry operator(extensions.<->) pt limit 1;
    how := 'nearest';
  end if;
  if hit is null then
    if not exists(select 1 from public.rg_coverage c where extensions.st_covers(c.geometry, pt)) then
      return jsonb_build_object('method','outside_region');
    end if;
    return jsonb_build_object('method','region_only','label','Region II (Cagayan Valley)');
  end if;
  select code, name, parent_code into b from public.rg_locations where code = hit;
  select code, name, parent_code into m from public.rg_locations where code = b.parent_code;
  select code, name into p from public.rg_locations where code = m.parent_code;
  return jsonb_build_object('method', how, 'distance_m', round(distance::numeric, 1),
    'barangay_code', b.code, 'barangay', b.name, 'municipality_code', m.code, 'municipality', m.name,
    'province_code', p.code, 'province', p.name,
    'label', 'Brgy. ' || b.name || ', ' || m.name || ', ' || p.name);
end $$;
revoke all on function public.rg_reverse_geocode(double precision, double precision) from public;
grant execute on function public.rg_reverse_geocode(double precision, double precision) to anon, authenticated, service_role;

-- 5. Completion now queues the automation. Adds the lesion-bundle workflow pin.
create or replace function public.rg_complete_pinned_job(p_job uuid, p_sequence bigint, p_manifest jsonb)
returns integer language plpgsql security definer set search_path to '' as $function$
declare j public.rg_processing_jobs; s public.rg_surveys; next_revision integer;
  detected text[]; asset_ids text[]; primary_disease text;
begin
  select * into j from public.rg_processing_jobs where id=p_job for update;
  if j.id is null or j.provider is distinct from 'kaggle_yolo26' or
    j.manifest->>'execution_provider' is distinct from 'kaggle_yolo26' or
    coalesce(j.manifest->>'pinned_workflow_sha256', '') not in ('20d3fc452a6f4575791162fbf28a21a592cf7b9ea8992852940e165459b03eb2',
      '7695ca57f8d093c05fe73c916bb9c13315b615b6210ef76343dae0423a84ab62',
      '09533f998a7e51ad8f44703aef1d7dee8eb91b4251681a538cabe881b5bec5b0',
      'df3d156e64d778ea818fdb34005a340570661d40e0d9a306ec891087f68a35de')
    then raise exception 'Pinned Kaggle job not found'; end if;
  if j.result_manifest is not null then
    if j.result_manifest=p_manifest then
      select revision into next_revision from public.rg_result_revisions where job_id=p_job;
      return next_revision;
    end if;
    raise exception 'Result revision already finalized';
  end if;
  if j.status not in ('Running','Validating results','Submitting') or
    p_sequence<=j.callback_sequence then raise exception 'Job is not ready for callback'; end if;
  if p_manifest->>'schema_version' is distinct from 'riceguard.result.v2' or
    p_manifest->>'run_id' is distinct from j.run_id or
    p_manifest->>'source_manifest_hash' is distinct from j.manifest_hash or
    p_manifest#>>'{model_bundle,workflow_sha256}' is distinct from j.manifest->>'pinned_workflow_sha256' or
    p_manifest#>>'{model_bundle,workflow_id}' is distinct from 'kaggle-private-two-specialist-media-v1'
    then raise exception 'Unverified pinned result contract'; end if;
  select * into s from public.rg_surveys where id=j.survey_id for update;
  next_revision := coalesce(s.active_result_revision,0)+1;
  select array_agg(distinct finding->>'disease' order by finding->>'disease') into detected
  from jsonb_array_elements(p_manifest->'assets') asset, jsonb_array_elements(asset->'diseases') finding
  where finding->>'status'='detected' and finding->>'disease' in ('BLB','Brown Spot');
  select array_agg(asset->>'id' order by asset->>'id') into asset_ids
  from jsonb_array_elements(j.manifest->'assets') asset;
  insert into public.rg_job_callbacks(job_id,sequence,event,payload)
    values(p_job,p_sequence,'complete-v2',jsonb_build_object('result_schema','riceguard.result.v2'));
  insert into public.rg_result_revisions(survey_id,job_id,revision,manifest,drive_folder_id,
    blb_model_version,brown_spot_model_version,blb_coverage,brown_spot_affected_leaf_coverage,
    visible_leaf_denominator_reviewed,severity_status,severity_label,warnings)
    values(j.survey_id,p_job,next_revision,p_manifest,'',
      p_manifest->'model_bundle'->'models'->'BLB'->>'version',
      p_manifest->'model_bundle'->'models'->'Brown Spot'->>'version',
      null,null,false,'not_calibrated','not_calibrated',p_manifest->'warnings');
  if cardinality(coalesce(detected,array[]::text[]))>0 then
    primary_disease := detected[1];
    insert into public.rg_bulletins(survey_id,slug,title,location,disease,diseases,severity,
      body,action,limitations,status,image,lat,lng,result_revision,
      public_location_approved,media_approved,source_ids,auto_generated,verification_status)
      values(j.survey_id,lower(j.run_id)||'-field-review-r'||next_revision,
        'Rice Field Health Advisory — '||s.name,s.location,primary_disease,detected,'not_calibrated',
        'Preparing the automated advisory.','Preparing the automated advisory.',
        'Automated finding; a specialist may still accept or reject it.',
        'draft','',s.lat,s.lng,next_revision,false,false,asset_ids,true,'unverified');
  end if;
  update public.rg_processing_jobs set callback_sequence=p_sequence,progress=100,
    status='Needs review',result_manifest=p_manifest,error=null,updated_at=now(),completed_at=now()
    where id=p_job;
  update public.rg_surveys set status='Needs review',progress=100,
    active_result_revision=next_revision,severity='not_calibrated',stage_updated_at=now(),
    auto_status='pending',auto_mode='initial',auto_attempts=0,auto_next_at=now(),auto_error=null
    where id=j.survey_id;
  return next_revision;
end $function$;

-- 6. Claim the next survey for the automation worker (atomic, crash-safe lease).
create or replace function public.rg_auto_claim(p_survey uuid default null)
returns setof public.rg_surveys language plpgsql security definer set search_path to '' as $$
begin
  return query
  update public.rg_surveys s set auto_status='running', auto_attempts=s.auto_attempts+1,
    auto_next_at=now() + interval '10 minutes', auto_error=null
  where s.id in (
    select id from public.rg_surveys
    where archived_at is null and (p_survey is null or id = p_survey)
      and ((auto_status in ('pending','retry') and coalesce(auto_next_at, now()) <= now())
        or (auto_status = 'running' and auto_next_at < now()))
    order by auto_next_at nulls first limit case when p_survey is null then 3 else 1 end
    for update skip locked)
  returning s.*;
end $$;

-- 7. Publish provisionally (or republish a revision) and queue SMS. Service role only.
create or replace function public.rg_auto_publish(p_bulletin uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare b public.rg_bulletins; s public.rg_surveys; campaign uuid; recipient_count integer := 0;
  verification text := coalesce(p_payload->>'verification_status','unverified');
  send_sms boolean := coalesce((p_payload->>'send_sms')::boolean, true);
  public_lat numeric; public_lng numeric;
begin
  if verification not in ('unverified','verified','corrected') then raise exception 'Invalid verification status'; end if;
  select * into b from public.rg_bulletins where id=p_bulletin for update;
  if not found or b.archived_at is not null then raise exception 'Advisory unavailable'; end if;
  select * into s from public.rg_surveys where id=b.survey_id for update;
  if jsonb_typeof(p_payload->'diseases') <> 'array' or jsonb_array_length(p_payload->'diseases') = 0
    or jsonb_typeof(p_payload->'public_media') <> 'array' or jsonb_array_length(p_payload->'public_media') = 0
    or coalesce(length(trim(p_payload->>'body')),0) < 20 or coalesce(length(trim(p_payload->>'action')),0) < 10
    then raise exception 'Incomplete automated advisory'; end if;
  public_lat := case when s.lat is not null then round(s.lat::numeric, 4) end;
  public_lng := case when s.lng is not null then round(s.lng::numeric, 4) end;
  update public.rg_bulletins set
    title=coalesce(nullif(trim(p_payload->>'title'),''), b.title),
    body=trim(p_payload->>'body'), action=trim(p_payload->>'action'),
    limitations=coalesce(nullif(trim(p_payload->>'limitations'),''), b.limitations),
    diseases=array(select jsonb_array_elements_text(p_payload->'diseases')),
    disease=(p_payload->'diseases'->>0), severity=coalesce(p_payload->>'severity','not_calibrated'),
    severity_detail=p_payload->'severity_detail', advisory_sources=p_payload->'advisory_sources',
    place=p_payload->'place', location=coalesce(nullif(p_payload->>'location',''), b.location),
    lat=s.lat, lng=s.lng, public_location_approved=s.lat is not null, media_approved=true,
    public_media=p_payload->'public_media', image=p_payload->'public_media'->0->>'url',
    correction_note=nullif(p_payload->>'correction_note',''),
    verification_status=verification,
    verified_at=case when verification='unverified' then null else coalesce(b.verified_at, now()) end,
    verified_by=case when verification='unverified' then null else nullif(p_payload->>'verified_by','')::uuid end,
    status='published', published_at=coalesce(b.published_at, now()),
    advisory_revision=b.advisory_revision + 1, revision=b.revision + 1,
    context_review_required=false, updated_at=now()
  where id=b.id returning * into b;
  insert into public.rg_public_posts(id,slug,title,approximate_location,disease,diseases,assessment_label,summary,
    recommended_actions,limitations,cover_url,media,reviewer_name,approximate_lat,approximate_lng,revision,
    correction_note,published_at,updated_at,advisory_sources,verification_status,verified_at,severity_detail,place)
  values(b.id,b.slug,b.title,b.location,b.disease,b.diseases,b.severity,b.body,b.action,b.limitations,b.image,
    b.public_media,case when verification='unverified' then 'RiceGuardAI automated analysis' else 'Verified by RiceGuardAI specialist' end,
    public_lat,public_lng,b.advisory_revision,b.correction_note,b.published_at,b.updated_at,b.advisory_sources,
    verification,b.verified_at,b.severity_detail,b.place)
  on conflict(id) do update set title=excluded.title,approximate_location=excluded.approximate_location,
    disease=excluded.disease,diseases=excluded.diseases,assessment_label=excluded.assessment_label,
    summary=excluded.summary,recommended_actions=excluded.recommended_actions,limitations=excluded.limitations,
    cover_url=excluded.cover_url,media=excluded.media,reviewer_name=excluded.reviewer_name,
    approximate_lat=excluded.approximate_lat,approximate_lng=excluded.approximate_lng,revision=excluded.revision,
    correction_note=excluded.correction_note,updated_at=excluded.updated_at,advisory_sources=excluded.advisory_sources,
    verification_status=excluded.verification_status,verified_at=excluded.verified_at,
    severity_detail=excluded.severity_detail,place=excluded.place;
  if send_sms and coalesce(length(p_payload->>'sms_text'),0) between 20 and 2000 and s.lat is not null and s.lng is not null then
    insert into public.rg_campaigns(bulletin_id,revision,message_text,kind)
      values(b.id,b.advisory_revision,p_payload->>'sms_text',coalesce(p_payload->>'campaign_kind','advisory'))
      on conflict(bulletin_id,revision) do nothing returning id into campaign;
    if campaign is not null then
      insert into public.rg_recipients(campaign_id,contact_id,phone,client_message_id)
        select distinct on (c.id) campaign, c.id, c.phone,
          left(encode(extensions.digest(convert_to(campaign::text||':'||c.id::text,'UTF8'),'sha256'),'hex'),32)
        from public.rg_contacts c join public.rg_farms f on f.contact_id=c.id
        where c.consent and c.verified and extensions.st_dwithin(f.geometry,
          extensions.st_setsrid(extensions.st_makepoint(s.lng,s.lat),4326)::extensions.geography,3000)
        on conflict(campaign_id,phone) do nothing;
      get diagnostics recipient_count = row_count;
      update public.rg_campaigns set recipients=recipient_count where id=campaign;
    end if;
  end if;
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('advisory-auto-published',b.id::text,null,
    jsonb_build_object('advisory_revision',b.advisory_revision,'verification_status',verification,
      'campaign_id',campaign,'recipients',recipient_count,'diseases',b.diseases,'severity',b.severity));
  return jsonb_build_object('bulletin_id',b.id,'slug',b.slug,'advisory_revision',b.advisory_revision,
    'campaign_id',campaign,'recipients',recipient_count);
end $$;

-- 8. Every finding rejected: withdraw the post and tell the same farmers it was a false alarm.
create or replace function public.rg_auto_retract(p_bulletin uuid, p_sms_text text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare b public.rg_bulletins; campaign uuid; recipient_count integer := 0;
begin
  select * into b from public.rg_bulletins where id=p_bulletin for update;
  if not found then raise exception 'Advisory unavailable'; end if;
  update public.rg_recipients set status='suppressed', error='Advisory withdrawn after specialist review'
    where status='queued' and campaign_id in (select id from public.rg_campaigns where bulletin_id=b.id);
  if coalesce(length(p_sms_text),0) between 20 and 2000 then
    insert into public.rg_campaigns(bulletin_id,revision,message_text,kind)
      values(b.id,b.advisory_revision+1,p_sms_text,'correction')
      on conflict(bulletin_id,revision) do nothing returning id into campaign;
    if campaign is not null then
      insert into public.rg_recipients(campaign_id,contact_id,phone,client_message_id)
        select distinct on (r.contact_id) campaign, r.contact_id, r.phone,
          left(encode(extensions.digest(convert_to(campaign::text||':'||r.contact_id::text,'UTF8'),'sha256'),'hex'),32)
        from public.rg_recipients r join public.rg_campaigns c on c.id=r.campaign_id
        join public.rg_contacts ct on ct.id=r.contact_id
        where c.bulletin_id=b.id and c.id<>campaign and r.status in ('accepted','sent','delivered','unknown')
          and ct.consent and ct.verified
        on conflict(campaign_id,phone) do nothing;
      get diagnostics recipient_count = row_count;
      update public.rg_campaigns set recipients=recipient_count where id=campaign;
    end if;
  end if;
  -- The correction SMS is sent while the bulletin row stays "published" (send-sms requires it);
  -- the public post disappears now.
  update public.rg_bulletins set verification_status='retracted', verified_at=now(), verified_by=p_actor,
    advisory_revision=b.advisory_revision+1, correction_note='Specialist review found no target disease.', updated_at=now()
    where id=b.id;
  delete from public.rg_public_posts where id=b.id;
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('advisory-auto-retracted',b.id::text,p_actor,
    jsonb_build_object('campaign_id',campaign,'recipients',recipient_count));
  return jsonb_build_object('retracted',true,'campaign_id',campaign,'recipients',recipient_count);
end $$;

-- 8b. Specialist confirmed every finding: flip the badge without a new revision, so SMS still
-- queued for this revision (for example during quiet hours) is not suppressed.
create or replace function public.rg_mark_verified(p_bulletin uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare b public.rg_bulletins;
begin
  update public.rg_bulletins set verification_status='verified', verified_at=now(), verified_by=p_actor, updated_at=now()
    where id=p_bulletin and archived_at is null and status='published' returning * into b;
  if b.id is null then raise exception 'Advisory unavailable'; end if;
  update public.rg_public_posts set verification_status='verified', verified_at=b.verified_at,
    reviewer_name='Verified by RiceGuardAI specialist', updated_at=now() where id=b.id;
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('advisory-verified',b.id::text,p_actor,
    jsonb_build_object('advisory_revision',b.advisory_revision));
  return jsonb_build_object('verified',true,'advisory_revision',b.advisory_revision);
end $$;

-- 9. Specialist accept/reject per finding. Then the automation re-runs in "verify" mode.
create or replace function public.rg_verify_findings(p_job uuid, p_actor uuid, p_reviews jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare j public.rg_processing_jobs; s public.rg_surveys; item jsonb; expected_count integer; accepted text[];
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active)
    then raise exception 'Active admin role required'; end if;
  select * into j from public.rg_processing_jobs where id=p_job for update;
  if j.id is null or j.provider<>'kaggle_yolo26' or j.status not in ('Needs review','Reviewed')
    or j.result_manifest->>'schema_version'<>'riceguard.result.v2' then raise exception 'Result is not ready for review'; end if;
  select * into s from public.rg_surveys where id=j.survey_id for update;
  if jsonb_typeof(p_reviews)<>'array' then raise exception 'Review decisions must be an array'; end if;
  select count(*) into expected_count from jsonb_array_elements(j.result_manifest->'assets') a,
    jsonb_array_elements(a->'diseases') f where f->>'status'='detected';
  if jsonb_array_length(p_reviews)<>expected_count or expected_count<1 then
    raise exception 'Decide every detected finding exactly once'; end if;
  for item in select value from jsonb_array_elements(p_reviews) loop
    if item->>'decision' not in ('accepted','rejected')
      or (item->>'decision'='rejected' and coalesce(item->>'reason','') not in ('healthy','other_disease','unclear','other'))
      or (item->>'reason'='other' and coalesce(length(trim(item->>'note')),0) not between 2 and 500)
      or not exists(select 1 from jsonb_array_elements(j.result_manifest->'assets') a, jsonb_array_elements(a->'diseases') f
        where a->>'source_asset_id'=item->>'source_asset_id' and f->>'disease'=item->>'disease' and f->>'status'='detected')
      then raise exception 'Decision does not match a detected finding'; end if;
    insert into public.rg_finding_reviews(job_id,source_asset_id,disease,decision,reviewed_by,reason,note)
      values(j.id,(item->>'source_asset_id')::uuid,item->>'disease',item->>'decision',p_actor,
        case when item->>'decision'='rejected' then item->>'reason' end,nullif(trim(item->>'note'),''))
      on conflict(job_id,source_asset_id,disease) do update set decision=excluded.decision,
        reviewed_by=excluded.reviewed_by,reviewed_at=now(),reason=excluded.reason,note=excluded.note;
  end loop;
  select array_agg(distinct disease order by disease) into accepted from public.rg_finding_reviews
    where job_id=j.id and decision='accepted';
  update public.rg_processing_jobs set status='Reviewed',updated_at=now() where id=j.id;
  update public.rg_surveys set status='Reviewed',approved_result_revision=active_result_revision,reviewed_by=p_actor,
    reviewed_at=now(),stage_updated_at=now(),auto_status='pending',auto_mode='verify',auto_attempts=0,
    auto_next_at=now(),auto_error=null where id=s.id;
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('findings-verified',s.id::text,p_actor,
    jsonb_build_object('job_id',j.id,'accepted_diseases',coalesce(accepted,array[]::text[]),'decisions',p_reviews));
  return jsonb_build_object('accepted_diseases',coalesce(accepted,array[]::text[]));
end $$;

revoke all on function public.rg_auto_claim(uuid) from public, anon, authenticated;
revoke all on function public.rg_auto_publish(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rg_auto_retract(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.rg_verify_findings(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rg_mark_verified(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rg_auto_claim(uuid), public.rg_auto_publish(uuid, jsonb),
  public.rg_auto_retract(uuid, text, uuid), public.rg_verify_findings(uuid, uuid, jsonb),
  public.rg_mark_verified(uuid, uuid) to service_role;

-- 10. Sweeper: retries anything the callback trigger missed.
select cron.unschedule('riceguard-auto-pipeline') where exists(select 1 from cron.job where jobname='riceguard-auto-pipeline');
select cron.schedule('riceguard-auto-pipeline', '*/2 * * * *', $$select private.rg_invoke_edge('auto-pipeline')$$);
