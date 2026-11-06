-- Field context recorded at upload: whether the paddy is irrigated or rainfed, and the rice variety.
-- Stored with each survey so staff can later compare them with the confirmed diseases.
alter table public.rg_surveys
  add column if not exists irrigation text not null default 'unknown',
  add column if not exists rice_variety text;

alter table public.rg_surveys drop constraint if exists rg_surveys_irrigation_check;
alter table public.rg_surveys add constraint rg_surveys_irrigation_check
  check (irrigation in ('unknown', 'irrigated', 'rainfed'));
alter table public.rg_surveys drop constraint if exists rg_surveys_rice_variety_check;
alter table public.rg_surveys add constraint rg_surveys_rice_variety_check
  check (rice_variety is null or length(rice_variety) between 1 and 120);

-- Edit name, note, irrigation and variety together. The older four-argument version stays for callers
-- that only change the name and note.
create or replace function public.rg_update_survey(p_survey uuid, p_actor uuid, p_name text, p_note text,
  p_irrigation text, p_rice_variety text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare s public.rg_surveys;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active)
    then raise exception 'Active admin role required'; end if;
  if coalesce(length(trim(p_name)),0) not between 3 and 160 then raise exception 'Survey name must be 3 to 160 characters'; end if;
  if coalesce(p_irrigation,'unknown') not in ('unknown','irrigated','rainfed') then raise exception 'Unsupported irrigation value'; end if;
  update public.rg_surveys set name=trim(p_name), note=nullif(left(trim(coalesce(p_note,'')),1000),''),
    irrigation=coalesce(p_irrigation,'unknown'), rice_variety=nullif(left(trim(coalesce(p_rice_variety,'')),120),''),
    stage_updated_at=now()
    where id=p_survey and archived_at is null returning * into s;
  if s.id is null then raise exception 'Survey unavailable'; end if;
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('survey-updated',s.id::text,p_actor,
    jsonb_build_object('irrigation',s.irrigation,'rice_variety',s.rice_variety));
  return jsonb_build_object('id',s.id);
end $$;
revoke all on function public.rg_update_survey(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.rg_update_survey(uuid,uuid,text,text,text,text) to service_role;
