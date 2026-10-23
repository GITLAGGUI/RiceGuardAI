-- Additive review state. No existing assessment or public projection is rewritten.
begin;
alter table public.rg_bulletins add column if not exists location_review jsonb;
alter table public.rg_bulletins add column if not exists context_review_required boolean not null default false;

create or replace function public.rg_review_evidence_key(p_id uuid)
returns text language sql stable set search_path='' as $$
  select md5(jsonb_build_object('survey',b.survey_id,'result',b.result_revision,
    'diseases',(select jsonb_agg(d order by d) from unnest(b.diseases) d),
    'media_approved',b.media_approved,
    'manifest',(select j.result_manifest from public.rg_processing_jobs j
      where j.survey_id=b.survey_id and j.result_manifest is not null order by j.created_at desc,j.id desc limit 1),
    'finding_reviews',(select jsonb_agg(jsonb_build_object('asset',r.source_asset_id,'disease',r.disease,'decision',r.decision)
      order by r.source_asset_id,r.disease) from public.rg_finding_reviews r where r.job_id=(
        select j.id from public.rg_processing_jobs j where j.survey_id=b.survey_id and j.result_manifest is not null order by j.created_at desc,j.id desc limit 1)))::text)
  from public.rg_bulletins b where b.id=p_id;
$$;

create or replace function public.rg_review_readiness(p_id uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare b public.rg_bulletins; s public.rg_surveys; k text; images_ok boolean; severity_ok boolean;
  location_ok boolean; content_ok boolean; pin_ok boolean;
begin
  select * into b from public.rg_bulletins where id=p_id and archived_at is null;
  if not found then raise exception 'Advisory unavailable'; end if;
  select * into s from public.rg_surveys where id=b.survey_id and archived_at is null;
  if not found then raise exception 'Survey unavailable'; end if;
  k := public.rg_review_evidence_key(b.id);
  images_ok := coalesce(s.status='Reviewed' and s.active_result_revision=s.approved_result_revision
    and b.result_revision=s.approved_result_revision and b.media_approved
    and cardinality(b.diseases)>0 and b.diseases <@ array['BLB','Brown Spot']::text[],false);
  severity_ok := coalesce(s.field_assessment->>'evidence_key'=k
    and s.field_assessment->>'bulletin_id'=b.id::text
    and s.field_assessment->>'result_revision'=b.result_revision::text
    and not exists(select 1 from unnest(b.diseases) d
      where coalesce(s.field_assessment->'diseases'->d->>'category','') not in ('low','moderate','high','not_assessed')),false);
  pin_ok := coalesce(s.lat between -90 and 90 and s.lng between -180 and 180
    and exists(select 1 from public.rg_coverage c where extensions.st_covers(c.geometry,
      extensions.st_setsrid(extensions.st_makepoint(s.lng,s.lat),4326))),false);
  location_ok := coalesce(b.location_review->>'evidence_key'=k
    and b.location_review->>'location'=s.location
    and b.location_review->'lat' is not distinct from coalesce(to_jsonb(s.lat),'null'::jsonb)
    and b.location_review->'lng' is not distinct from coalesce(to_jsonb(s.lng),'null'::jsonb)
    and ((b.location_review->>'mode'='no_pin' and not b.public_location_approved)
      or (b.location_review->>'mode'='approximate_pin' and b.public_location_approved and pin_ok)),false);
  content_ok := coalesce(length(trim(b.title))>0 and length(trim(b.body))>0 and length(trim(b.action))>0
    and not b.context_review_required and not exists(select 1 from unnest(b.diseases) d where not exists(
      select 1 from public.rg_advisory_sources a where a.id=any(b.advisory_source_ids) and a.disease=d and a.active)),false);
  return jsonb_build_object('bulletin_id',b.id,'survey_id',s.id,'advisory_revision',b.advisory_revision,
    'published',b.status='published','ready',images_ok and severity_ok and location_ok and content_ok,
    'evidence_key',k,'public_path','/advisories/'||b.slug,
    'map_eligible',case when b.status='published' then exists(select 1 from public.rg_public_posts p where p.id=b.id and p.approximate_lat is not null and p.approximate_lng is not null) else location_ok and b.public_location_approved and pin_ok end,
    'steps',jsonb_build_array(
      jsonb_build_object('step','images','complete',images_ok,'reason',case when images_ok then 'Images and findings reviewed.' else 'Approve the current result, accepted diseases and review media.' end),
      jsonb_build_object('step','severity','complete',severity_ok,'reason',case when severity_ok then 'Every accepted disease has a reviewed outcome.' else 'Save a grade or an explicit not-assessed review for every accepted disease.' end),
      jsonb_build_object('step','location','complete',location_ok,'reason',case when location_ok then 'Public location choice confirmed.' else 'Confirm an approximate map pin or publication without a pin.' end),
      jsonb_build_object('step','publish','complete',content_ok,'reason',case when content_ok then 'Advisory and disease guidance ready for your final approval.' when b.context_review_required then 'Location changed. Review and save the location-sensitive advisory wording.' else 'Save the advisory and include approved guidance for every accepted disease.' end)));
end $$;

create or replace function public.rg_save_severity_review(p_id uuid,p_result integer,p_expected integer,p_actor uuid,p_entries jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.rg_bulletins; s public.rg_surveys; entry jsonb; combined jsonb; grade text; k text; seen text[] := '{}';
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active) then raise exception 'Active admin role required'; end if;
  select * into b from public.rg_bulletins where id=p_id for update;
  select * into s from public.rg_surveys where id=b.survey_id for update;
  if b.id is null or s.id is null or b.archived_at is not null or s.archived_at is not null then raise exception 'Advisory unavailable'; end if;
  if b.status='published' then raise exception 'Create a correction before changing published severity'; end if;
  if b.advisory_revision is distinct from p_expected or b.result_revision is distinct from p_result
    or s.active_result_revision is distinct from p_result or s.approved_result_revision is distinct from p_result
    or s.status<>'Reviewed' then raise exception 'Stale or unreviewed result. Reload before saving'; end if;
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) is distinct from cardinality(b.diseases)
    or cardinality(b.diseases) not between 1 and 2 then raise exception 'Review every accepted disease exactly once'; end if;
  combined := case when s.field_assessment->>'result_revision'=p_result::text then coalesce(s.field_assessment->'diseases','{}') else '{}'::jsonb end;
  for entry in select value from jsonb_array_elements(p_entries) loop
    if coalesce(entry->>'disease','')<>all(b.diseases) or entry->>'disease'=any(seen)
      or entry->'model_calibrated' is distinct from 'false'::jsonb
      or coalesce(length(trim(entry->>'specialist')),0) not between 2 and 120
      or coalesce(length(trim(entry->>'notes')),0) not between 20 and 2000
      or entry->'confirmed' is distinct from 'true'::jsonb then raise exception 'Valid confirmed disease review required'; end if;
    seen := array_append(seen,entry->>'disease');
    if entry->>'basis'='not_assessed' then
      if entry->>'category' is distinct from 'not_assessed' then raise exception 'Not assessed cannot contain a grade'; end if;
    elsif entry->>'basis' in ('reviewed_visual_estimate','manual_field_assessment') and entry->>'category' in ('low','moderate','high') then
      if entry->>'basis'='reviewed_visual_estimate' and (entry->>'advisory_revision')::integer is distinct from p_expected then raise exception 'Stale visual assessment'; end if;
      if entry->>'basis'='manual_field_assessment' and (
        jsonb_typeof(entry->'leaf_area_affected_pct') is distinct from 'number' or jsonb_typeof(entry->'sampled_leaves') is distinct from 'number'
        or (entry->>'leaf_area_affected_pct')::numeric not between 0 and 100
        or (entry->>'sampled_leaves')::numeric not between 1 and 10000
        or (entry->>'sampled_leaves')::numeric<>trunc((entry->>'sampled_leaves')::numeric)) then raise exception 'Valid independent leaf measurements required'; end if;
    else raise exception 'Valid assessment basis and category required'; end if;
    combined := combined || jsonb_build_object(entry->>'disease',entry || jsonb_build_object('recorded_by',p_actor,'recorded_at',now()));
  end loop;
  k := public.rg_review_evidence_key(b.id);
  select case when bool_or(value->>'category'='not_assessed') then 'not_calibrated'
    when bool_or(value->>'category'='high') then 'high' when bool_or(value->>'category'='moderate') then 'moderate' else 'low' end
    into grade from jsonb_each(combined) where key=any(b.diseases);
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('severity-review-saved',b.id::text,p_actor,
    jsonb_build_object('previous',s.field_assessment,'entries',p_entries,'result_revision',p_result,'evidence_key',k));
  update public.rg_surveys set severity=grade,stage_updated_at=now(),field_assessment=jsonb_build_object(
    'basis','reviewed_severity_assessment','model_calibrated',false,'result_revision',p_result,'bulletin_id',b.id,'evidence_key',k,'diseases',combined) where id=s.id;
  update public.rg_bulletins set severity=grade,advisory_revision=advisory_revision+1,
    recipient_preview_hash=null,reviewer=null,reviewer_id=null,updated_at=now() where id=b.id;
  return public.rg_review_readiness(b.id);
end $$;

create or replace function public.rg_save_review_location(p_id uuid,p_expected integer,p_actor uuid,p_choice jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.rg_bulletins; s public.rg_surveys; latitude double precision; longitude double precision; changed boolean; mode text; location_label text;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active) then raise exception 'Active admin role required'; end if;
  select * into b from public.rg_bulletins where id=p_id for update;
  select * into s from public.rg_surveys where id=b.survey_id for update;
  if b.id is null or s.id is null or b.archived_at is not null or s.archived_at is not null then raise exception 'Advisory unavailable'; end if;
  if b.status='published' then raise exception 'Create a correction before changing a published location'; end if;
  if b.advisory_revision is distinct from p_expected or s.status<>'Reviewed'
    or b.result_revision is distinct from s.approved_result_revision then raise exception 'Stale or unreviewed result. Reload before saving'; end if;
  mode := p_choice->>'mode';
  if mode is null or mode not in ('approximate_pin','no_pin') or p_choice->'confirmed' is distinct from 'true'::jsonb then raise exception 'Confirm your public location choice'; end if;
  latitude := s.lat; longitude := s.lng;
  location_label := coalesce(trim(p_choice->>'location'),s.location);
  if coalesce(length(location_label),0) not between 2 and 240 then raise exception 'Enter a reviewed location label'; end if;
  if p_choice ? 'lat' or p_choice ? 'lng' then
    if jsonb_typeof(p_choice->'lat') is distinct from 'number' or jsonb_typeof(p_choice->'lng') is distinct from 'number' then raise exception 'Valid coordinates required'; end if;
    latitude := (p_choice->>'lat')::double precision; longitude := (p_choice->>'lng')::double precision;
    if not (latitude between -90 and 90 and longitude between -180 and 180) or (latitude=0 and longitude=0)
      or not exists(select 1 from public.rg_coverage c where extensions.st_covers(c.geometry,extensions.st_setsrid(extensions.st_makepoint(longitude,latitude),4326))) then raise exception 'Location outside verified Region II coverage'; end if;
  end if;
  if mode='approximate_pin' and (latitude is null or longitude is null or not exists(select 1 from public.rg_coverage c where extensions.st_covers(c.geometry,extensions.st_setsrid(extensions.st_makepoint(longitude,latitude),4326)))) then raise exception 'Select a valid Region II map pin'; end if;
  changed := latitude is distinct from s.lat or longitude is distinct from s.lng or location_label is distinct from s.location;
  if changed then update public.rg_surveys set lat=latitude,lng=longitude,location=location_label,location_status=case when latitude is null then 'missing' else 'verified' end,stage_updated_at=now() where id=s.id; end if;
  update public.rg_bulletins set lat=latitude,lng=longitude,location=location_label,public_location_approved=mode='approximate_pin',
    location_review=jsonb_build_object('mode',mode,'lat',latitude,'lng',longitude,'location',location_label,'evidence_key',public.rg_review_evidence_key(b.id),'actor',p_actor,'at',now()),
    context_review_required=context_review_required or changed,advisory_revision=advisory_revision+1,
    recipient_preview_hash=null,reviewer=null,reviewer_id=null,updated_at=now() where id=b.id;
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('location-review-saved',b.id::text,p_actor,
    jsonb_build_object('old_lat',s.lat,'old_lng',s.lng,'old_location',s.location,'choice',p_choice,'context_review_required',changed));
  return public.rg_review_readiness(b.id);
end $$;

-- Keep the verified prior publisher and its gallery/SMS-decoupling protections.
do $$ begin
  if to_regprocedure('public.rg_publish_bulletin_before_guided_review(uuid,uuid,integer,text)') is null then
    alter function public.rg_publish_bulletin_v2(uuid,uuid,integer,text) rename to rg_publish_bulletin_before_guided_review;
  end if;
end $$;
create or replace function public.rg_publish_bulletin_v2(p_id uuid,p_actor uuid,p_expected_revision integer,p_recipient_preview_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare b public.rg_bulletins; r jsonb;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active) then raise exception 'Active admin role required'; end if;
  select * into b from public.rg_bulletins where id=p_id for update;
  if b.id is null or b.archived_at is not null then raise exception 'Advisory unavailable'; end if;
  if b.advisory_revision is distinct from p_expected_revision then raise exception 'Stale advisory revision'; end if;
  if b.status='published' then return true; end if;
  perform 1 from public.rg_surveys where id=b.survey_id for update;
  r := public.rg_review_readiness(b.id);
  if r->'ready' is distinct from 'true'::jsonb then raise exception 'Complete images, severity, location and advisory review before publication'; end if;
  return public.rg_publish_bulletin_before_guided_review(p_id,p_actor,p_expected_revision,p_recipient_preview_hash);
end $$;

revoke all on function public.rg_review_evidence_key(uuid), public.rg_review_readiness(uuid),
  public.rg_save_severity_review(uuid,integer,integer,uuid,jsonb),public.rg_save_review_location(uuid,integer,uuid,jsonb),
  public.rg_publish_bulletin_v2(uuid,uuid,integer,text),public.rg_publish_bulletin_before_guided_review(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.rg_review_evidence_key(uuid),public.rg_review_readiness(uuid),
  public.rg_save_severity_review(uuid,integer,integer,uuid,jsonb),public.rg_save_review_location(uuid,integer,uuid,jsonb),
  public.rg_publish_bulletin_v2(uuid,uuid,integer,text) to service_role;
-- The old publisher is now internal-only (its owner may call it through the guarded wrapper).
revoke all on function public.rg_publish_bulletin_before_guided_review(uuid,uuid,integer,text) from service_role;
commit;
