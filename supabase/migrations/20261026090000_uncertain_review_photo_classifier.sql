-- Specialist "Uncertain" decision and the pre-upload photo review with classifier percentages.
--
-- Uncertain keeps a finding on record (with a reason such as dry leaf or soil nitrogen) but, like
-- Mali, it is not counted in the public post, severity or SMS. Only Tama findings are published.

alter table public.rg_finding_reviews drop constraint if exists rg_finding_reviews_reason_check;
alter table public.rg_finding_reviews add constraint rg_finding_reviews_reason_check
  check (reason in ('healthy','other_disease','unclear','other','dry_leaf','soil_nitrogen'));

-- Per-photo output of the first-step classifier, run in the uploader's browser before upload:
-- {"model": "...", "probs": {"BLB": 0.81, "Brown Spot": 0.04, "Soil Nitrogen": 0.15}, "top": "BLB",
--  "uncertain": false, "tiles": 24}
alter table public.rg_assets add column if not exists classification jsonb
  check (classification is null or (jsonb_typeof(classification)='object' and jsonb_typeof(classification->'probs')='object'));

-- Who approved the photos before upload and automation, and with which classifier.
alter table public.rg_surveys add column if not exists pre_review jsonb
  check (pre_review is null or (jsonb_typeof(pre_review)='object' and (pre_review->>'approved')::boolean is true));

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
  if jsonb_typeof(p_reviews) is distinct from 'array' then raise exception 'Review decisions must be an array'; end if;
  select count(*) into expected_count from jsonb_array_elements(j.result_manifest->'assets') a,
    jsonb_array_elements(a->'diseases') f where f->>'status'='detected';
  if jsonb_array_length(p_reviews)<>expected_count or expected_count<1 then
    raise exception 'Decide every detected finding exactly once'; end if;
  if (select count(*) from (select distinct value->>'source_asset_id', value->>'disease'
      from jsonb_array_elements(p_reviews)) unique_findings) <> expected_count then
    raise exception 'Decide every detected finding exactly once'; end if;
  for item in select value from jsonb_array_elements(p_reviews) loop
    if coalesce(item->>'decision','') not in ('accepted','rejected','uncertain')
      or (item->>'decision'='rejected' and coalesce(item->>'reason','') not in
        ('healthy','other_disease','unclear','other','dry_leaf','soil_nitrogen'))
      or (item->>'decision'='uncertain' and coalesce(item->>'reason','') not in ('dry_leaf','soil_nitrogen','unclear','other'))
      or (item->>'reason'='other' and coalesce(length(trim(item->>'note')),0) not between 2 and 500)
      or not exists(select 1 from jsonb_array_elements(j.result_manifest->'assets') a, jsonb_array_elements(a->'diseases') f
        where a->>'source_asset_id'=item->>'source_asset_id' and f->>'disease'=item->>'disease' and f->>'status'='detected')
      then raise exception 'Decision does not match a detected finding'; end if;
    insert into public.rg_finding_reviews(job_id,source_asset_id,disease,decision,reviewed_by,reason,note)
      values(j.id,(item->>'source_asset_id')::uuid,item->>'disease',item->>'decision',p_actor,
        case when item->>'decision' in ('rejected','uncertain') then item->>'reason' end,nullif(trim(item->>'note'),''))
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

revoke all on function public.rg_verify_findings(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rg_verify_findings(uuid, uuid, jsonb) to service_role;
