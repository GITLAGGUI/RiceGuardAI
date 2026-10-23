-- AI suggestions remain private and cannot set a public/map grade by themselves.
alter table public.rg_bulletins add column if not exists severity_recommendation jsonb;
create or replace function public.rg_save_field_severity(p_survey uuid,p_revision integer,p_actor uuid,p_evidence jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.rg_surveys; b public.rg_bulletins; combined jsonb; category text; basis text;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active)
    then raise exception 'Active admin role required'; end if;
  select * into s from public.rg_surveys where id=p_survey for update;
  if not found or s.status<>'Reviewed' or s.archived_at is not null or s.active_result_revision is distinct from p_revision
    then raise exception 'Reload the current reviewed result revision'; end if;
  if exists(select 1 from public.rg_bulletins where survey_id=s.id and status='published' and archived_at is null)
    then raise exception 'Create an advisory correction before changing published severity'; end if;
  select * into b from public.rg_bulletins where survey_id=s.id and status='draft' and archived_at is null
    and result_revision=p_revision and p_evidence->>'disease'=any(diseases) order by created_at desc limit 1 for update;
  if not found then raise exception 'Assess an accepted disease after approving the survey'; end if;
  category := p_evidence->>'category'; basis := p_evidence->>'basis';
  if category is null or category not in ('low','moderate','high') or basis is null or
    basis not in ('manual_field_assessment','reviewed_visual_estimate') or
    coalesce(length(p_evidence->>'notes'),0) not between 20 and 2000 or
    coalesce(length(p_evidence->>'specialist'),0) not between 2 and 120 or
    p_evidence->'model_calibrated' is distinct from 'false'::jsonb
    then raise exception 'Valid reviewed severity evidence required'; end if;
  if basis='manual_field_assessment' then
    if p_evidence->>'leaf_area_affected_pct' is null or p_evidence->>'sampled_leaves' is null or
      (p_evidence->>'leaf_area_affected_pct')::numeric not between 0 and 100 or
      (p_evidence->>'sampled_leaves')::numeric not between 1 and 10000 or
      (p_evidence->>'sampled_leaves')::numeric <> trunc((p_evidence->>'sampled_leaves')::numeric)
      then raise exception 'Measured leaf damage and independent sample count required'; end if;
  else
    if p_evidence->'confirmed' is distinct from 'true'::jsonb or
      (p_evidence->>'advisory_revision')::integer is distinct from b.advisory_revision
      then raise exception 'Confirm the current visual assessment revision'; end if;
  end if;
  combined := case when s.field_assessment->>'result_revision'=p_revision::text
    then coalesce(s.field_assessment->'diseases','{}'::jsonb) else '{}'::jsonb end;
  combined := combined || jsonb_build_object(p_evidence->>'disease',p_evidence || jsonb_build_object('recorded_by',p_actor,'recorded_at',now()));
  select case when bool_or(value->>'category'='high') then 'high'
    when bool_or(value->>'category'='moderate') then 'moderate' else 'low' end into category from jsonb_each(combined);
  if exists(select 1 from unnest(b.diseases) d where not (combined ? d)) then category := 'not_calibrated'; end if;
  update public.rg_surveys set severity=category,field_assessment=jsonb_build_object('basis','reviewed_severity_assessment',
    'model_calibrated',false,'result_revision',p_revision,'diseases',combined),stage_updated_at=now() where id=s.id;
  update public.rg_bulletins set severity=category,advisory_revision=advisory_revision+1,
    recipient_preview_hash=null,reviewer=null,reviewer_id=null,updated_at=now()
    where survey_id=s.id and status='draft' and archived_at is null;
  insert into public.rg_events(kind,entity_id,actor_id,detail)
    values('field-severity-assessed',s.id::text,p_actor,p_evidence || jsonb_build_object('result_revision',p_revision));
  return true;
end $$;
revoke all on function public.rg_save_field_severity(uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.rg_save_field_severity(uuid,integer,uuid,jsonb) to service_role;

-- Recoverable deletion, with immediate public withdrawal and queued SMS suppression.
create or replace function public.rg_archive_advisory(p_id uuid,p_actor uuid,p_expected_revision integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare b public.rg_bulletins;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active)
    then raise exception 'Active admin role required'; end if;
  select * into b from public.rg_bulletins where id=p_id for update;
  if not found or b.archived_at is not null then raise exception 'Advisory unavailable'; end if;
  if b.advisory_revision is distinct from p_expected_revision then raise exception 'Reload the current advisory revision'; end if;
  insert into public.rg_events(kind,entity_id,actor_id,detail)
    values('advisory-archived',b.id::text,p_actor,jsonb_build_object('recoverable',true,'advisory_snapshot',to_jsonb(b)));
  update public.rg_bulletins set archived_at=now(),status='draft',advisory_revision=advisory_revision+1,recipient_preview_hash=null,updated_at=now() where id=b.id;
  delete from public.rg_public_posts where id=b.id;
  update public.rg_recipients set status='suppressed',error='Advisory withdrawn by administrator'
    where status='queued' and campaign_id in (select id from public.rg_campaigns where bulletin_id=b.id);
  return true;
end $$;
revoke all on function public.rg_archive_advisory(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.rg_archive_advisory(uuid,uuid,integer) to service_role;
