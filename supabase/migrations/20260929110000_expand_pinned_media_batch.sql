-- A field survey can contain ten native photos plus one linked presentation
-- clip. Every asset still carries exactly two independent specialist reviews.
create or replace function public.rg_review_pinned_job(
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
  if jsonb_array_length(p_reviews)<>expected_count or expected_count<2 or expected_count>22
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
      values(j.id,source_id,class_name,verdict);
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
