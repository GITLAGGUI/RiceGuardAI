-- Staged, service-role-only review path for private dual-specialist Kaggle
-- results. This migration does not dispatch a kernel or publish a bulletin.
create or replace function public.rg_claim_dispatch_v2(p_owner text,p_lease_seconds integer default 90)
returns public.rg_processing_jobs language plpgsql security definer set search_path='' as $$
declare j public.rg_processing_jobs;
begin
  if exists(select 1 from public.rg_processing_jobs active
    where active.provider='kaggle_yolo26'
      and active.status in ('Submitting','Running','Validating results'))
    then return null; end if;
  select jobs.* into j
  from public.rg_processing_jobs jobs
  join public.rg_outbox outbox on outbox.entity_id=jobs.id
    and outbox.kind='kaggle-dispatch' and outbox.state='pending'
    and outbox.available_at<=now()
  where jobs.provider='kaggle_yolo26'
    and jobs.status in ('Queued','Waiting for GPU')
    and jobs.manifest->>'execution_provider'='kaggle_yolo26'
    and jobs.manifest->>'pinned_workflow_sha256'=
      'bc8dc16cd98949221cc282c830d9cad146dee71108e8a838cb7372e2016df21c'
    and (jobs.lease_expires_at is null or jobs.lease_expires_at<now())
  order by jobs.created_at for update of jobs skip locked limit 1;
  if j.id is null then return null; end if;
  update public.rg_processing_jobs set status='Submitting',lease_owner=p_owner,
    lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,30),300)),
    submit_attempts=submit_attempts+1,updated_at=now()
    where id=j.id returning * into j;
  return j;
end $$;
revoke all on function public.rg_claim_dispatch_v2(text,integer) from public,anon,authenticated;
grant execute on function public.rg_claim_dispatch_v2(text,integer) to service_role;

create function public.rg_complete_pinned_job(p_job uuid,p_sequence bigint,p_manifest jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare j public.rg_processing_jobs; s public.rg_surveys; next_revision integer;
  detected text[]; asset_ids text[]; primary_disease text;
begin
  select * into j from public.rg_processing_jobs where id=p_job for update;
  if j.id is null or j.provider is distinct from 'kaggle_yolo26' or
    j.manifest->>'execution_provider' is distinct from 'kaggle_yolo26' or
    j.manifest->>'pinned_workflow_sha256' is distinct from
      'bc8dc16cd98949221cc282c830d9cad146dee71108e8a838cb7372e2016df21c'
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
    p_manifest#>>'{model_bundle,workflow_sha256}' is distinct from
      j.manifest->>'pinned_workflow_sha256' or
    p_manifest#>>'{model_bundle,workflow_id}' is distinct from
      'kaggle-private-two-specialist-media-v1'
    then raise exception 'Unverified pinned result contract'; end if;
  select * into s from public.rg_surveys where id=j.survey_id for update;
  next_revision := coalesce(s.active_result_revision,0)+1;
  select array_agg(distinct finding->>'disease' order by finding->>'disease') into detected
  from jsonb_array_elements(p_manifest->'assets') asset,
       jsonb_array_elements(asset->'diseases') finding
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
      public_location_approved,media_approved,source_ids)
      values(j.survey_id,lower(j.run_id)||'-field-review-r'||next_revision,
        'Field review — '||s.name,s.location,primary_disease,detected,'not_calibrated',
        'AI-assisted findings await staff review; this is not a confirmed field diagnosis.',
        'Confirm each disease finding and approved guidance before publication.',
        'Masks identify proposed regions or affected leaves; lesion-area severity is not available.',
        'draft','',s.lat,s.lng,next_revision,false,false,asset_ids);
  end if;
  update public.rg_processing_jobs set callback_sequence=p_sequence,progress=100,
    status='Needs review',result_manifest=p_manifest,error=null,updated_at=now(),completed_at=now()
    where id=p_job;
  update public.rg_surveys set status='Needs review',progress=100,
    active_result_revision=next_revision,severity='not_calibrated',stage_updated_at=now()
    where id=j.survey_id;
  return next_revision;
end $$;
revoke all on function public.rg_complete_pinned_job(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.rg_complete_pinned_job(uuid,bigint,jsonb) to service_role;

-- The existing AWS review procedure remains unchanged. This sibling accepts
-- two findings per photo plus two for the optional 30 FPS video.
create function public.rg_review_pinned_job(
  p_job uuid,p_revision integer,p_actor uuid,p_reviews jsonb,
  p_location_approved boolean,p_media_approved boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.rg_processing_jobs; s public.rg_surveys;
  row_item jsonb; source_id uuid; class_name text; verdict text;
  expected_count integer; accepted text[];
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active)
    then raise exception 'Active admin role required'; end if;
  select * into j from public.rg_processing_jobs where id=p_job for update;
  if j.id is null or j.provider<>'kaggle_yolo26' or j.status<>'Needs review' or
    j.result_manifest->>'schema_version'<>'riceguard.result.v2'
    then raise exception 'Pinned result is not ready for review'; end if;
  select * into s from public.rg_surveys where id=j.survey_id for update;
  if s.status<>'Needs review' or s.active_result_revision is distinct from p_revision or
    not exists(select 1 from public.rg_result_revisions
      where survey_id=s.id and job_id=j.id and revision=p_revision)
    then raise exception 'Stale or unbound result revision'; end if;
  if jsonb_typeof(p_reviews)<>'array' then raise exception 'Review decisions must be an array'; end if;
  select count(*) into expected_count
    from jsonb_array_elements(j.result_manifest->'assets') asset,
         jsonb_array_elements(asset->'diseases') finding;
  if jsonb_array_length(p_reviews)<>expected_count or expected_count<2 or expected_count>10
    then raise exception 'Review every asset and disease exactly once'; end if;
  for row_item in select value from jsonb_array_elements(p_reviews) loop
    source_id := (row_item->>'source_asset_id')::uuid;
    class_name := row_item->>'disease';
    verdict := row_item->>'decision';
    if class_name not in ('BLB','Brown Spot') or verdict not in ('accepted','rejected','uncertain') or
      not exists (
        select 1 from jsonb_array_elements(j.result_manifest->'assets') asset,
          jsonb_array_elements(asset->'diseases') finding
        where asset->>'source_asset_id'=source_id::text and finding->>'disease'=class_name
      ) then raise exception 'Decision does not match the immutable result'; end if;
    insert into public.rg_finding_reviews(job_id,source_asset_id,disease,decision,reviewed_by)
      values(j.id,source_id,class_name,verdict,p_actor);
  end loop;
  select array_agg(distinct r.disease order by r.disease) into accepted
    from public.rg_finding_reviews r,
         jsonb_array_elements(j.result_manifest->'assets') asset,
         jsonb_array_elements(asset->'diseases') finding
    where r.job_id=j.id and r.source_asset_id::text=asset->>'source_asset_id'
      and r.disease=finding->>'disease' and r.decision='accepted'
      and finding->>'status'='detected';
  update public.rg_bulletins set diseases=coalesce(accepted,array[]::text[]),
    disease=coalesce(accepted[1],disease),
    public_location_approved=coalesce(p_location_approved,false) and s.lat is not null and s.lng is not null,
    media_approved=coalesce(p_media_approved,false),updated_at=now()
    where survey_id=s.id and result_revision=p_revision and status='draft';
  update public.rg_surveys set status='Reviewed',approved_result_revision=p_revision,
    reviewed_by=p_actor,reviewed_at=now(),stage_updated_at=now() where id=s.id;
  update public.rg_processing_jobs set status='Reviewed',updated_at=now() where id=j.id;
  insert into public.rg_events(kind,entity_id,actor_id,detail)
    values('pinned-result-reviewed',s.id::text,p_actor,
      jsonb_build_object('job_id',j.id,'result_revision',p_revision,
        'accepted_diseases',coalesce(accepted,array[]::text[])));
  return jsonb_build_object('reviewed',true,'result_revision',p_revision,
    'accepted_diseases',coalesce(accepted,array[]::text[]));
end $$;
revoke all on function public.rg_review_pinned_job(uuid,integer,uuid,jsonb,boolean,boolean)
  from public,anon,authenticated;
grant execute on function public.rg_review_pinned_job(uuid,integer,uuid,jsonb,boolean,boolean)
  to service_role;

-- Keep pinned-result publication closed until the separate public-media
-- staging path can strip EXIF, retain staff-only coordinates and verify the
-- exact staff-selected photo/video derivatives. Review alone is not release.
create or replace function private.rg_require_public_cover() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.status='published' then
    if nullif(new.image,'') is null or cardinality(new.diseases)=0
      then raise exception 'Reviewed disease and sanitized cover are required'; end if;
    if exists(select 1 from public.rg_surveys
      where id=new.survey_id and inference_provider in ('aws','kaggle_yolo26'))
      and (jsonb_array_length(new.public_media)=0 or
        new.image is distinct from new.public_media->0->>'url')
      then raise exception 'Approved private-result media must be staged before publication'; end if;
  end if;
  return new;
end $$;
