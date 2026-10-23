create or replace function public.rg_save_field_severity(p_survey uuid,p_revision integer,p_actor uuid,p_evidence jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.rg_surveys; existing jsonb; combined jsonb; category text;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active)
    then raise exception 'Active admin role required'; end if;
  select * into s from public.rg_surveys where id=p_survey for update;
  if not found or s.status<>'Reviewed' or s.archived_at is not null or s.active_result_revision is distinct from p_revision
    then raise exception 'Reload the current reviewed result revision'; end if;
  if exists(select 1 from public.rg_bulletins where survey_id=s.id and status='published')
    then raise exception 'Create an advisory correction before changing published severity'; end if;
  if not exists(select 1 from public.rg_bulletins b where b.survey_id=s.id and b.status='draft' and b.archived_at is null and p_evidence->>'disease'=any(b.diseases))
    then raise exception 'Assess an accepted disease after approving the survey'; end if;
  category := p_evidence->>'category';
  if category not in ('low','moderate','high') or p_evidence->>'basis'<>'manual_field_assessment' or
    p_evidence->>'disease' not in ('BLB','Brown Spot') or
    (p_evidence->>'leaf_area_affected_pct')::numeric not between 0 and 100 or
    (p_evidence->>'sampled_leaves')::integer not between 1 and 10000 or
    length(p_evidence->>'notes')<20 or length(p_evidence->>'specialist')<2
    then raise exception 'Valid field assessment evidence required'; end if;
  existing := case when s.field_assessment->>'result_revision'=p_revision::text then coalesce(s.field_assessment->'diseases','{}'::jsonb) else '{}'::jsonb end;
  combined := existing || jsonb_build_object(p_evidence->>'disease',p_evidence || jsonb_build_object('recorded_by',p_actor,'recorded_at',now()));
  select case when bool_or(value->>'category'='high') then 'high'
    when bool_or(value->>'category'='moderate') then 'moderate' else 'low' end into category from jsonb_each(combined);
  if exists(select 1 from public.rg_bulletins b,unnest(b.diseases) d
    where b.survey_id=s.id and b.status='draft' and not (combined ? d)) then category := 'not_calibrated'; end if;
  update public.rg_surveys set severity=category,field_assessment=jsonb_build_object('basis','manual_field_assessment',
    'model_calibrated',false,'result_revision',p_revision,'diseases',combined),stage_updated_at=now() where id=s.id;
  update public.rg_bulletins set severity=category,advisory_revision=advisory_revision+1,
    recipient_preview_hash=null,reviewer=null,reviewer_id=null,updated_at=now() where survey_id=s.id and status='draft';
  insert into public.rg_events(kind,entity_id,actor_id,detail)
    values('field-severity-assessed',s.id::text,p_actor,p_evidence || jsonb_build_object('result_revision',p_revision,'model_calibrated',false));
  return true;
end $$;
revoke all on function public.rg_save_field_severity(uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.rg_save_field_severity(uuid,integer,uuid,jsonb) to service_role;
