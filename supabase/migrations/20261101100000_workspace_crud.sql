-- Workspace edit and delete for contacts and surveys. Called only by the field-operations
-- Edge Function after its active-admin + MFA check (service role); RLS stays read-only for staff.

create or replace function public.rg_update_contact(p_contact uuid, p_actor uuid, p_name text, p_phone text, p_location text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare c public.rg_contacts; phone_changed boolean;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active)
    then raise exception 'Active admin role required'; end if;
  if coalesce(length(trim(p_name)),0) not between 1 and 120 then raise exception 'Name is required (120 characters at most)'; end if;
  if p_phone !~ '^\+639\d{9}$' then raise exception 'Invalid Philippine mobile number'; end if;
  select * into c from public.rg_contacts where id=p_contact for update;
  if not found then raise exception 'Contact unavailable'; end if;
  phone_changed := c.phone is distinct from p_phone;
  -- A new number has not confirmed anything: it loses verification and consent until re-verified.
  update public.rg_contacts set name=trim(p_name), phone=p_phone,
    location=coalesce(nullif(trim(p_location),''), c.location),
    verified=case when phone_changed then false else c.verified end,
    consent=case when phone_changed then false else c.consent end
  where id=p_contact returning * into c;
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('contact-updated',c.id::text,p_actor,
    jsonb_build_object('phone_changed',phone_changed));
  return jsonb_build_object('id',c.id,'phone_changed',phone_changed,'verified',c.verified,'consent',c.consent);
end $$;

create or replace function public.rg_delete_contact(p_contact uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare c public.rg_contacts; suppressed integer;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active)
    then raise exception 'Active admin role required'; end if;
  select * into c from public.rg_contacts where id=p_contact for update;
  if not found then raise exception 'Contact unavailable'; end if;
  if exists(select 1 from public.rg_recipients where contact_id=c.id and status not in ('queued','suppressed')) then
    -- Message history must stay attributable: withdraw consent instead of erasing the row.
    update public.rg_contacts set consent=false, verified=false, name='Removed contact', location='Removed' where id=c.id;
    update public.rg_recipients set status='suppressed', error='Contact removed by staff' where contact_id=c.id and status='queued';
    delete from public.rg_farms where contact_id=c.id;
    insert into public.rg_events(kind,entity_id,actor_id,detail) values('contact-removed',c.id::text,p_actor,
      jsonb_build_object('mode','anonymized','reason','has message history'));
    return jsonb_build_object('deleted',false,'anonymized',true);
  end if;
  delete from public.rg_recipients where contact_id=c.id and status in ('queued','suppressed');
  get diagnostics suppressed = row_count;
  update public.rg_campaigns set selected_contact_id=null where selected_contact_id=c.id;
  delete from public.rg_consent_events where contact_id=c.id;
  delete from public.rg_farms where contact_id=c.id;
  delete from public.rg_contacts where id=c.id;
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('contact-removed',c.id::text,p_actor,
    jsonb_build_object('mode','deleted','unsent_messages_removed',suppressed));
  return jsonb_build_object('deleted',true,'anonymized',false);
end $$;

create or replace function public.rg_update_survey(p_survey uuid, p_actor uuid, p_name text, p_note text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare s public.rg_surveys;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active)
    then raise exception 'Active admin role required'; end if;
  if coalesce(length(trim(p_name)),0) not between 3 and 160 then raise exception 'Survey name must be 3 to 160 characters'; end if;
  update public.rg_surveys set name=trim(p_name), note=nullif(left(trim(coalesce(p_note,'')),1000),''), stage_updated_at=now()
    where id=p_survey and archived_at is null returning * into s;
  if s.id is null then raise exception 'Survey unavailable'; end if;
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('survey-updated',s.id::text,p_actor,'{}'::jsonb);
  return jsonb_build_object('id',s.id);
end $$;

-- Archive (recoverable) instead of erasing: the survey, its unpublished drafts and queued SMS leave
-- the workspace; a published advisory must be withdrawn from the advisory desk first.
create or replace function public.rg_archive_survey(p_survey uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare s public.rg_surveys;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active)
    then raise exception 'Active admin role required'; end if;
  select * into s from public.rg_surveys where id=p_survey and archived_at is null for update;
  if not found then raise exception 'Survey unavailable'; end if;
  if exists(select 1 from public.rg_bulletins where survey_id=s.id and archived_at is null and status='published'
      and verification_status is distinct from 'retracted') then
    raise exception 'Withdraw the published advisory for this survey first';
  end if;
  if exists(select 1 from public.rg_processing_jobs where survey_id=s.id and status in ('Submitting','Running','Validating results')) then
    raise exception 'Wait until processing for this survey stops';
  end if;
  update public.rg_processing_jobs set status='Cancelled', updated_at=now() where survey_id=s.id and status in ('Queued','Waiting for GPU');
  update public.rg_outbox set state='complete', last_error='Survey archived' where kind='kaggle-dispatch' and state='pending'
    and entity_id in (select id from public.rg_processing_jobs where survey_id=s.id);
  update public.rg_bulletins set archived_at=now() where survey_id=s.id and archived_at is null;
  update public.rg_surveys set archived_at=now(), auto_status=case when auto_status in ('pending','retry','running') then null else auto_status end
    where id=s.id;
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('survey-archived',s.id::text,p_actor,'{}'::jsonb);
  return jsonb_build_object('archived',true);
end $$;

revoke all on function public.rg_update_contact(uuid,uuid,text,text,text), public.rg_delete_contact(uuid,uuid),
  public.rg_update_survey(uuid,uuid,text,text), public.rg_archive_survey(uuid,uuid) from public, anon, authenticated;
grant execute on function public.rg_update_contact(uuid,uuid,text,text,text), public.rg_delete_contact(uuid,uuid),
  public.rg_update_survey(uuid,uuid,text,text), public.rg_archive_survey(uuid,uuid) to service_role;
