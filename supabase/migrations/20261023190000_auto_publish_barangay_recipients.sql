-- Farmers who registered only a barangay (no farm pin) also get alerts: a verified, consenting
-- contact is a recipient when a pinned farm OR their registered barangay lies within 3 km of the field.
create or replace function public.rg_auto_publish(p_bulletin uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare b public.rg_bulletins; s public.rg_surveys; campaign uuid; recipient_count integer := 0;
  verification text := coalesce(p_payload->>'verification_status','unverified');
  send_sms boolean := coalesce((p_payload->>'send_sms')::boolean, true);
  public_lat numeric; public_lng numeric;
begin
  if verification not in ('unverified','verified','corrected') then raise exception 'Invalid verification status'; end if;
  select * into b from public.rg_bulletins where id=p_bulletin for update;
  if not found or b.archived_at is not null then raise exception 'Advisory unavailable'; end if;
  select * into s from public.rg_surveys where id=b.survey_id for update;
  if jsonb_typeof(p_payload->'diseases') <> 'array' or jsonb_array_length(p_payload->'diseases') = 0
    or jsonb_typeof(p_payload->'public_media') <> 'array' or jsonb_array_length(p_payload->'public_media') = 0
    or coalesce(length(trim(p_payload->>'body')),0) < 20 or coalesce(length(trim(p_payload->>'action')),0) < 10
    then raise exception 'Incomplete automated advisory'; end if;
  public_lat := case when s.lat is not null then round(s.lat::numeric, 4) end;
  public_lng := case when s.lng is not null then round(s.lng::numeric, 4) end;
  update public.rg_bulletins set
    title=coalesce(nullif(trim(p_payload->>'title'),''), b.title),
    body=trim(p_payload->>'body'), action=trim(p_payload->>'action'),
    limitations=coalesce(nullif(trim(p_payload->>'limitations'),''), b.limitations),
    diseases=array(select jsonb_array_elements_text(p_payload->'diseases')),
    disease=(p_payload->'diseases'->>0), severity=coalesce(p_payload->>'severity','not_calibrated'),
    severity_detail=p_payload->'severity_detail', advisory_sources=p_payload->'advisory_sources',
    place=p_payload->'place', location=coalesce(nullif(p_payload->>'location',''), b.location),
    lat=s.lat, lng=s.lng, public_location_approved=s.lat is not null, media_approved=true,
    public_media=p_payload->'public_media', image=p_payload->'public_media'->0->>'url',
    correction_note=nullif(p_payload->>'correction_note',''),
    verification_status=verification,
    verified_at=case when verification='unverified' then null else coalesce(b.verified_at, now()) end,
    verified_by=case when verification='unverified' then null else nullif(p_payload->>'verified_by','')::uuid end,
    status='published', published_at=coalesce(b.published_at, now()),
    advisory_revision=b.advisory_revision + 1, revision=b.revision + 1,
    context_review_required=false, updated_at=now()
  where id=b.id returning * into b;
  insert into public.rg_public_posts(id,slug,title,approximate_location,disease,diseases,assessment_label,summary,
    recommended_actions,limitations,cover_url,media,reviewer_name,approximate_lat,approximate_lng,revision,
    correction_note,published_at,updated_at,advisory_sources,verification_status,verified_at,severity_detail,place)
  values(b.id,b.slug,b.title,b.location,b.disease,b.diseases,b.severity,b.body,b.action,b.limitations,b.image,
    b.public_media,case when verification='unverified' then 'RiceGuardAI automated analysis' else 'Verified by RiceGuardAI specialist' end,
    public_lat,public_lng,b.advisory_revision,b.correction_note,b.published_at,b.updated_at,b.advisory_sources,
    verification,b.verified_at,b.severity_detail,b.place)
  on conflict(id) do update set title=excluded.title,approximate_location=excluded.approximate_location,
    disease=excluded.disease,diseases=excluded.diseases,assessment_label=excluded.assessment_label,
    summary=excluded.summary,recommended_actions=excluded.recommended_actions,limitations=excluded.limitations,
    cover_url=excluded.cover_url,media=excluded.media,reviewer_name=excluded.reviewer_name,
    approximate_lat=excluded.approximate_lat,approximate_lng=excluded.approximate_lng,revision=excluded.revision,
    correction_note=excluded.correction_note,updated_at=excluded.updated_at,advisory_sources=excluded.advisory_sources,
    verification_status=excluded.verification_status,verified_at=excluded.verified_at,
    severity_detail=excluded.severity_detail,place=excluded.place;
  if send_sms and coalesce(length(p_payload->>'sms_text'),0) between 20 and 2000 and s.lat is not null and s.lng is not null then
    insert into public.rg_campaigns(bulletin_id,revision,message_text,kind)
      values(b.id,b.advisory_revision,p_payload->>'sms_text',coalesce(p_payload->>'campaign_kind','advisory'))
      on conflict(bulletin_id,revision) do nothing returning id into campaign;
    if campaign is not null then
      insert into public.rg_recipients(campaign_id,contact_id,phone,client_message_id)
        select distinct on (c.id) campaign, c.id, c.phone,
          left(encode(extensions.digest(convert_to(campaign::text||':'||c.id::text,'UTF8'),'sha256'),'hex'),32)
        from public.rg_contacts c
        where c.consent and c.verified and (
          exists(select 1 from public.rg_farms f where f.contact_id=c.id and extensions.st_dwithin(f.geometry,
            extensions.st_setsrid(extensions.st_makepoint(s.lng,s.lat),4326)::extensions.geography,3000))
          or exists(select 1 from public.rg_barangay_boundaries bb where bb.code=c.barangay_code and extensions.st_dwithin(
            bb.geometry::extensions.geography,
            extensions.st_setsrid(extensions.st_makepoint(s.lng,s.lat),4326)::extensions.geography,3000)))
        order by c.id
        on conflict(campaign_id,phone) do nothing;
      get diagnostics recipient_count = row_count;
      update public.rg_campaigns set recipients=recipient_count where id=campaign;
    end if;
  end if;
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('advisory-auto-published',b.id::text,null,
    jsonb_build_object('advisory_revision',b.advisory_revision,'verification_status',verification,
      'campaign_id',campaign,'recipients',recipient_count,'diseases',b.diseases,'severity',b.severity));
  return jsonb_build_object('bulletin_id',b.id,'slug',b.slug,'advisory_revision',b.advisory_revision,
    'campaign_id',campaign,'recipients',recipient_count);
end $$;
