-- Bulletin publication and SMS delivery are separate staff decisions.
-- This path publishes the reviewed advisory and sanitized media without
-- creating a campaign, recipients, or an SMS outbox item.
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
    jsonb_build_array(jsonb_build_object('url',b.image,'alt','Approved public survey preview','type','image')),
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
end $$;
revoke all on function public.rg_publish_bulletin_v2(uuid,uuid,integer,text)
  from public,anon,authenticated;
grant execute on function public.rg_publish_bulletin_v2(uuid,uuid,integer,text) to service_role;
