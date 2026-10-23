-- Staff-confirmed source guidance is installed atomically with its audit event.
-- Catalog candidates in Edge code are not approved merely by being published.
create function public.rg_approve_advisory_source(
  p_candidate_id text, p_disease text, p_title text, p_version text,
  p_guidance jsonb, p_reference text, p_actor uuid,
  p_specialist_name text, p_review_note text
) returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.rg_advisory_sources; approved_id uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active)
    then raise exception 'Active administrator required'; end if;
  if p_disease is null or p_title is null or p_version is null or p_candidate_id is null
    or p_reference is null or p_guidance is null or p_specialist_name is null or p_review_note is null
    or p_disease not in ('BLB','Brown Spot') or length(p_title) not between 1 and 200
    or length(p_version) not between 1 and 120 or length(p_candidate_id) not between 1 and 120
    or p_reference !~ '^https://(dbmp|www)\.philrice\.gov\.ph/'
    or jsonb_typeof(p_guidance)<>'object'
    or length(trim(p_specialist_name)) not between 2 and 120
    or length(trim(p_review_note)) not between 10 and 500
    then raise exception 'Invalid approved guidance review'; end if;
  select * into existing from public.rg_advisory_sources
    where disease=p_disease and version=p_version for update;
  if found then
    if existing.source_reference<>p_reference or existing.guidance<>p_guidance or not existing.active
      then raise exception 'This guidance version already exists with different or inactive content'; end if;
    return existing.id;
  end if;
  insert into public.rg_advisory_sources(
    disease,title,version,guidance,source_reference,reviewed_by,approved_at,active
  ) values(p_disease,p_title,p_version,p_guidance,p_reference,p_actor,now(),true)
  returning id into approved_id;
  insert into public.rg_events(kind,entity_id,actor_id,detail)
    values('advisory-guidance-approved',approved_id::text,p_actor,
      jsonb_build_object('candidate_id',p_candidate_id,'disease',p_disease,
        'source_reference',p_reference,'specialist_name',trim(p_specialist_name),
        'review_note',trim(p_review_note),'approved_at',now()));
  return approved_id;
end $$;
revoke all on function public.rg_approve_advisory_source(text,text,text,text,jsonb,text,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.rg_approve_advisory_source(text,text,text,text,jsonb,text,uuid,text,text)
  to service_role;

-- Publish only non-sensitive citations. A new v2 assessment cannot become a
-- public advisory unless each accepted disease has approved guidance.
alter table public.rg_public_posts
  add column if not exists advisory_sources jsonb not null default '[]'::jsonb;

create function private.rg_project_advisory_sources() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.rg_bulletins; needed text; is_v2 boolean;
begin
  select * into b from public.rg_bulletins where id=new.id;
  if not found then raise exception 'Published advisory has no source bulletin'; end if;
  select coalesce(r.manifest->>'schema_version'='riceguard.result.v2',false)
    into is_v2 from public.rg_result_revisions r
    where r.survey_id=b.survey_id and r.revision=b.result_revision;
  if coalesce(is_v2,false) then
    if cardinality(b.diseases)=0 then raise exception 'Reviewed disease decisions are missing'; end if;
    foreach needed in array b.diseases loop
      if not exists(select 1 from public.rg_advisory_sources s
        where s.id=any(b.advisory_source_ids) and s.active and s.disease=needed)
        then raise exception 'Approved advisory source missing for %', needed; end if;
    end loop;
  end if;
  new.advisory_sources := (
    select coalesce(jsonb_agg(jsonb_build_object('disease',s.disease,
      'title',s.title,'version',s.version,'reference',s.source_reference)
      order by s.disease,s.title,s.version),'[]'::jsonb)
    from public.rg_advisory_sources s
    where s.id=any(b.advisory_source_ids) and s.active
      and s.source_reference ~ '^https://'
  );
  return new;
end $$;
revoke all on function private.rg_project_advisory_sources() from public,anon,authenticated;
create trigger rg_public_post_advisory_sources
  before insert or update on public.rg_public_posts
  for each row execute function private.rg_project_advisory_sources();
