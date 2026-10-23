-- One staff-reviewed bulletin may represent both independently detected
-- diseases. Historical single-disease rows remain readable.
alter table public.rg_bulletins add column diseases text[] not null default '{}';
alter table public.rg_public_posts add column diseases text[] not null default '{}';
alter table public.rg_bulletins add constraint rg_bulletins_diseases_check
  check(diseases <@ array['BLB','Brown Spot']::text[]);
alter table public.rg_public_posts add constraint rg_public_posts_diseases_check
  check(diseases <@ array['BLB','Brown Spot']::text[]);
update public.rg_bulletins set diseases=array[disease] where disease in ('BLB','Brown Spot');
update public.rg_public_posts set diseases=array[disease] where disease in ('BLB','Brown Spot');
create index rg_public_posts_diseases on public.rg_public_posts using gin(diseases);

create function private.rg_sync_public_diseases() returns trigger
language plpgsql security definer set search_path='' as $$
declare selected text[];
begin
  select b.diseases into selected from public.rg_bulletins b where b.id=new.id;
  new.diseases := coalesce(selected,array[]::text[]);
  return new;
end $$;
revoke all on function private.rg_sync_public_diseases() from public,anon,authenticated;
create trigger rg_public_post_diseases before insert or update on public.rg_public_posts
  for each row execute function private.rg_sync_public_diseases();

-- Atomically install an authenticated AWS result, its revision and its one
-- draft bulletin. A retry returns the same revision rather than duplicating
-- publications or overwriting a staff-edited draft.
create function public.rg_complete_aws_job(p_job uuid,p_sequence bigint,p_manifest jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare j public.rg_processing_jobs; s public.rg_surveys; next_revision integer;
  detected text[]; asset_ids text[]; primary_disease text;
begin
  select * into j from public.rg_processing_jobs where id=p_job for update;
  if j.id is null or j.provider<>'aws' then raise exception 'AWS job not found'; end if;
  if j.result_manifest is not null then
    if j.result_manifest=p_manifest then
      select revision into next_revision from public.rg_result_revisions where job_id=p_job;
      return next_revision;
    end if;
    raise exception 'Result revision already finalized';
  end if;
  if j.status not in ('Running','Validating results','Submitting') then raise exception 'Job is not ready for callback'; end if;
  if p_sequence<=j.callback_sequence then raise exception 'Stale callback sequence'; end if;
  if p_manifest->>'schema_version'<>'riceguard.result.v2'
    or p_manifest->>'run_id'<>j.run_id
    or p_manifest->>'source_manifest_hash'<>j.manifest_hash
    or p_manifest#>>'{model_bundle,workflow_sha256}'<>'98faa7b8541366bfd5751036f8111930fa3bb8cb2f0233d90c6c3d82e683a0da'
    then raise exception 'Unverified result contract'; end if;
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
        'AI-assisted findings are awaiting staff review; this is not a confirmed field diagnosis.',
        'Confirm each disease finding and approved guidance before publication.',
        'The masks are semantic predictions; lesion-area severity is not available.',
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
revoke all on function public.rg_complete_aws_job(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.rg_complete_aws_job(uuid,bigint,jsonb) to service_role;

-- Do not publish a draft that has no sanitized cover media yet.
create function private.rg_require_public_cover() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.status='published' and nullif(new.image,'') is null then
    raise exception 'Sanitized public cover must be staged before publication';
  end if;
  return new;
end $$;
create trigger rg_bulletin_public_cover before insert or update on public.rg_bulletins
  for each row execute function private.rg_require_public_cover();
