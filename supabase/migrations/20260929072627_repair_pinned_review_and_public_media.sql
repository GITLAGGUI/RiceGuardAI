-- Repair the pinned Kaggle review audit insert and preserve every staged,
-- sanitized photo/video when a reviewed bulletin is published.
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

create or replace function public.rg_publish_bulletin_v2(
  p_id uuid,p_actor uuid,p_expected_revision integer,p_recipient_preview_hash text
) returns boolean language plpgsql security definer set search_path='' as $$
declare b public.rg_bulletins; s public.rg_surveys; public_lat numeric; public_lng numeric;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active)
    then raise exception 'Active admin role required'; end if;
  select * into b from public.rg_bulletins where id=p_id for update;
  if not found then raise exception 'Advisory not found'; end if;
  select * into s from public.rg_surveys where id=b.survey_id for update;
  if b.disease not in ('BLB','Brown Spot') then
    raise exception 'Historical disease labels cannot be newly published'; end if;
  if s.status<>'Reviewed' or s.approved_result_revision is null or
     b.result_revision<>s.approved_result_revision then
    raise exception 'Approve the exact result revision first'; end if;
  if b.advisory_revision<>p_expected_revision then raise exception 'Stale advisory revision'; end if;
  if b.recipient_preview_hash is distinct from p_recipient_preview_hash then
    raise exception 'Recipient preview changed; review again'; end if;
  if not b.media_approved then raise exception 'Approve public media first'; end if;
  if jsonb_typeof(b.public_media)<>'array' or jsonb_array_length(b.public_media)=0
    then raise exception 'Approved sanitized public media are required'; end if;
  if b.status='published' then return true; end if;

  public_lat := case when b.public_location_approved and s.lat is not null then round(s.lat::numeric,2) end;
  public_lng := case when b.public_location_approved and s.lng is not null then round(s.lng::numeric,2) end;
  update public.rg_bulletins set status='published',reviewer_id=p_actor,
    reviewer=(select full_name from public.profiles where id=p_actor),published_at=now(),updated_at=now()
    where id=b.id returning * into b;
  insert into public.rg_public_posts(
    id,slug,title,approximate_location,disease,assessment_label,summary,
    recommended_actions,limitations,cover_url,media,reviewer_name,
    approximate_lat,approximate_lng,revision,correction_note,published_at,updated_at
  ) values(
    b.id,b.slug,b.title,b.location,b.disease,b.severity,b.body,b.action,b.limitations,b.image,
    b.public_media,b.reviewer,public_lat,public_lng,b.advisory_revision,b.correction_note,b.published_at,b.updated_at
  ) on conflict(id) do update set
    title=excluded.title,approximate_location=excluded.approximate_location,
    assessment_label=excluded.assessment_label,summary=excluded.summary,
    recommended_actions=excluded.recommended_actions,limitations=excluded.limitations,
    cover_url=excluded.cover_url,media=excluded.media,reviewer_name=excluded.reviewer_name,
    approximate_lat=excluded.approximate_lat,approximate_lng=excluded.approximate_lng,
    revision=excluded.revision,correction_note=excluded.correction_note,updated_at=excluded.updated_at;
  insert into public.rg_events(kind,entity_id,actor_id,detail)
    values('bulletin-published',b.id::text,p_actor,
      jsonb_build_object('result_revision',b.result_revision,
        'advisory_revision',b.advisory_revision,'sms_enqueued',false,
        'public_media_count',jsonb_array_length(b.public_media)));
  return true;
end $$;
revoke all on function public.rg_publish_bulletin_v2(uuid,uuid,integer,text)
  from public,anon,authenticated;
grant execute on function public.rg_publish_bulletin_v2(uuid,uuid,integer,text) to service_role;
