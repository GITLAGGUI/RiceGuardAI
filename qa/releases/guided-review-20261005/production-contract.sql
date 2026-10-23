-- Generated from read-only production definitions, not production rows.
create schema private;
alter table rg_surveys add column inference_provider text default 'kaggle_yolo26';
alter table rg_advisory_sources add column version text default 'fixture';
alter table rg_public_posts add column diseases text[], add column advisory_sources jsonb;
create table rg_result_revisions(survey_id uuid,revision integer,manifest jsonb);
CREATE OR REPLACE FUNCTION public.rg_publish_bulletin_v2(p_id uuid, p_actor uuid, p_expected_revision integer, p_recipient_preview_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if jsonb_typeof(b.public_media)<>'array' or jsonb_array_length(b.public_media)=0 then
    raise exception 'Approved sanitized public media are required'; end if;
  if b.archived_at is not null or s.archived_at is not null then raise exception 'Archived records cannot be published'; end if;
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
    b.public_media,
    b.reviewer,public_lat,public_lng,b.advisory_revision,b.correction_note,b.published_at,b.updated_at
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
        'advisory_revision',b.advisory_revision,'sms_enqueued',false));
  return true;
end $function$
;
CREATE OR REPLACE FUNCTION private.rg_validate_geo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare point extensions.geometry;
begin
  if tg_table_name='rg_surveys' then
    if new.lat is null and new.lng is null then return new; end if;
    point := extensions.st_setsrid(extensions.st_makepoint(new.lng,new.lat),4326);
  else
    point := new.geometry::extensions.geometry;
  end if;
  if not exists(select 1 from public.rg_coverage c where extensions.st_covers(c.geometry,point)) then
    raise exception 'Location outside loaded Region II coverage or verified boundaries not loaded';
  end if;
  return new;
end $function$
;
CREATE TRIGGER rg_survey_geo BEFORE INSERT OR UPDATE OF lat, lng ON public.rg_surveys FOR EACH ROW EXECUTE FUNCTION private.rg_validate_geo();
CREATE OR REPLACE FUNCTION private.rg_require_public_cover()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$
;
CREATE TRIGGER rg_bulletin_public_cover BEFORE INSERT OR UPDATE ON public.rg_bulletins FOR EACH ROW EXECUTE FUNCTION private.rg_require_public_cover();
CREATE OR REPLACE FUNCTION private.rg_project_advisory_sources()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
CREATE TRIGGER rg_public_post_advisory_sources BEFORE INSERT OR UPDATE ON public.rg_public_posts FOR EACH ROW EXECUTE FUNCTION private.rg_project_advisory_sources();
CREATE OR REPLACE FUNCTION private.rg_sync_public_diseases()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.rg_bulletins;
begin
  select * into b from public.rg_bulletins where id=new.id;
  new.diseases := coalesce(b.diseases,array[]::text[]);
  if jsonb_array_length(b.public_media)>0 then
    new.media := b.public_media;
    new.cover_url := b.image;
  end if;
  return new;
end $function$
;
CREATE TRIGGER rg_public_post_diseases BEFORE INSERT OR UPDATE ON public.rg_public_posts FOR EACH ROW EXECUTE FUNCTION private.rg_sync_public_diseases();
