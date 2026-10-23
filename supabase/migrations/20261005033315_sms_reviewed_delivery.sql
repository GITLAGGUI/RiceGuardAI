-- Separate, explicit SMS campaigns. Preview is STABLE and performs no writes.
-- Existing bulletin publication functions remain unchanged.
alter table public.rg_campaigns add column if not exists message_text text;
alter table public.rg_campaigns add column if not exists preview_hash text;
alter table public.rg_campaigns add column if not exists selected_contact_id uuid references public.rg_contacts(id);
alter table public.rg_campaigns add column if not exists device_id text;
alter table public.rg_campaigns add column if not exists sim_number integer check(sim_number between 1 and 3);
alter table public.rg_campaigns add column if not exists enqueued_by uuid references auth.users(id);
alter table public.rg_recipients add column if not exists last_reconciled_at timestamptz;
alter table public.rg_recipients add column if not exists parts_expected integer check(parts_expected between 1 and 100);
alter table public.rg_recipients add column if not exists parts_delivered integer not null default 0 check(parts_delivered>=0);

create or replace function public.rg_sms_preview(p_bulletin uuid,p_message text,p_contact uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.rg_bulletins; s public.rg_surveys; recipient_ids text[]; recipients jsonb; digest text;
begin
 select * into b from public.rg_bulletins where id=p_bulletin;
 if not found or b.archived_at is not null or b.status<>'published' then raise exception 'Select an active published advisory'; end if;
 if not exists(select 1 from public.rg_public_posts where id=b.id and revision=b.advisory_revision) then raise exception 'Publish the current advisory revision first'; end if;
 if p_message is null or length(p_message)=0 or length(p_message)>2000 then raise exception 'Invalid SMS preview message'; end if;
 select * into s from public.rg_surveys where id=b.survey_id;
 select coalesce(array_agg(x.id::text||':'||x.phone order by x.id),'{}'),coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by x.id),'[]')
 into recipient_ids,recipients from (
  select distinct c.id,c.name,c.phone from public.rg_contacts c join public.rg_farms f on f.contact_id=c.id
  where c.consent and c.verified and (p_contact is null or c.id=p_contact)
   and s.archived_at is null and s.lat is not null and s.lng is not null and b.public_location_approved
   and extensions.st_dwithin(f.geometry,extensions.st_setsrid(extensions.st_makepoint(s.lng,s.lat),4326)::extensions.geography,3000)
 ) x;
 digest := encode(sha256(convert_to(b.id::text||':'||b.advisory_revision::text||':'||coalesce(p_contact::text,'all')||':'||array_to_string(recipient_ids,',')||':'||p_message,'UTF8')),'hex');
 return jsonb_build_object('id',b.id,'advisory_revision',b.advisory_revision,'count',cardinality(recipient_ids),'recipients',recipients,'hash',digest,
  'location_ready',s.archived_at is null and s.lat is not null and s.lng is not null and b.public_location_approved,
  'existing_campaign_id',(select id from public.rg_campaigns where bulletin_id=b.id and revision=b.advisory_revision));
end $$;
revoke all on function public.rg_sms_preview(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.rg_sms_preview(uuid,text,uuid) to service_role;

create or replace function public.rg_sms_enqueue(p_bulletin uuid,p_actor uuid,p_revision integer,p_hash text,p_message text,p_contact uuid default null,p_device text default null,p_sim integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.rg_bulletins; preview jsonb; campaign uuid; existing_hash text;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active) then raise exception 'Active admin role required'; end if;
 select * into b from public.rg_bulletins where id=p_bulletin for update;
 if not found then raise exception 'Advisory not found'; end if;
 if b.advisory_revision<>p_revision then raise exception 'Stale advisory revision; preview again'; end if;
 -- Lock eligible contact/farm state throughout preview recheck and insertion.
 perform id from public.rg_contacts order by id for share;
 perform id from public.rg_farms order by id for share;
 preview := public.rg_sms_preview(p_bulletin,p_message,p_contact);
 if preview->>'hash' is distinct from p_hash then raise exception 'SMS recipients or message changed; preview again'; end if;
 select id,preview_hash into campaign,existing_hash from public.rg_campaigns where bulletin_id=b.id and revision=p_revision;
 if campaign is not null then
  if existing_hash is distinct from p_hash then raise exception 'This advisory revision already has an SMS campaign'; end if;
  return jsonb_build_object('campaign_id',campaign,'duplicate',true,'recipients',(select recipients from public.rg_campaigns where id=campaign));
 end if;
 if (preview->>'count')::integer<1 then raise exception 'No eligible verified contacts within 3 km'; end if;
 insert into public.rg_campaigns(bulletin_id,revision,message_text,preview_hash,selected_contact_id,device_id,sim_number,enqueued_by)
 values(b.id,p_revision,p_message,p_hash,p_contact,p_device,p_sim,p_actor) returning id into campaign;
 insert into public.rg_recipients(campaign_id,contact_id,phone,client_message_id)
 -- Provider message IDs permit at most 36 characters. A deterministic 32-hex
 -- prefix retains 128 bits of collision resistance and meets that contract.
 select campaign,c.id,c.phone,left(encode(sha256(convert_to(campaign::text||':'||c.id::text,'UTF8')),'hex'),32) from public.rg_contacts c
 where c.id in(select (item->>'id')::uuid from jsonb_array_elements(preview->'recipients') item);
 update public.rg_campaigns set recipients=(preview->>'count')::integer where id=campaign;
 insert into public.rg_events(kind,entity_id,actor_id,detail) values('sms-campaign-enqueued',campaign::text,p_actor,
  jsonb_build_object('advisory_revision',p_revision,'recipient_count',(preview->>'count')::integer,'single_contact',p_contact is not null));
 return jsonb_build_object('campaign_id',campaign,'duplicate',false,'recipients',(preview->>'count')::integer);
end $$;
revoke all on function public.rg_sms_enqueue(uuid,uuid,integer,text,text,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.rg_sms_enqueue(uuid,uuid,integer,text,text,uuid,text,integer) to service_role;

-- Atomically claim each submission before crossing the gateway boundary.
-- A crash remains unknown and must be reconciled by ID, never blindly retried.
create or replace function public.rg_sms_claim(p_recipient uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.rg_recipients r set status='suppressed',error='Consent or approved campaign revision changed before dispatch'
 where r.id=p_recipient and r.status='queued' and not exists(
  select 1 from public.rg_contacts c join public.rg_campaigns campaign on campaign.id=r.campaign_id
  join public.rg_bulletins b on b.id=campaign.bulletin_id
  where c.id=r.contact_id and c.phone=r.phone and c.consent and c.verified and b.status='published' and b.archived_at is null
   and campaign.revision=b.advisory_revision and campaign.message_text is not null);
 update public.rg_recipients set status='unknown',message_id=client_message_id,attempts=attempts+1,last_attempt_at=now(),error='Submission in progress; reconcile by message ID if interrupted'
 where id=p_recipient and status='queued' and not_before<=now();
 return found;
end $$;
revoke all on function public.rg_sms_claim(uuid) from public,anon,authenticated;
grant execute on function public.rg_sms_claim(uuid) to service_role;

create or replace function public.rg_sms_campaign_stats() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc),'[]') from (
 select c.id,c.bulletin_id,c.created_at,c.sample,c.revision,
 count(r.id)::integer as recipients,
 jsonb_build_object('queued',count(r.id) filter(where r.status='queued'),'accepted',count(r.id) filter(where r.status='accepted'),
  'sent',count(r.id) filter(where r.status='sent'),'delivered',count(r.id) filter(where r.status='delivered'),
  'failed',count(r.id) filter(where r.status='failed'),'unknown',count(r.id) filter(where r.status='unknown'),
  'suppressed',count(r.id) filter(where r.status='suppressed')) as counts,
 case when count(r.id)=0 then 'suppressed'
  when bool_or(r.status='unknown') then 'unknown' when bool_or(r.status='queued') then 'queued'
  when bool_or(r.status='accepted') then 'accepted' when bool_or(r.status='sent') then 'sent'
  when bool_and(r.status='suppressed') then 'suppressed'
  when bool_and(r.status in('delivered','suppressed')) then 'delivered'
  when bool_and(r.status in('failed','suppressed')) then 'failed' else 'mixed' end as status,
 max(r.accepted_at) as accepted_at,max(r.delivered_at) as delivered_at
 from public.rg_campaigns c left join public.rg_recipients r on r.campaign_id=c.id group by c.id
 order by c.created_at desc limit 500
 ) x;
$$;
revoke all on function public.rg_sms_campaign_stats() from public,anon,authenticated;
grant execute on function public.rg_sms_campaign_stats() to service_role;

-- SMS Gate exposes no per-part states in its GET response. Its authenticated
-- sms:sent callback gives partsCount, and emits one unique sms:delivered event
-- per part. Record callbacks and counts atomically; retries keep the same id.
create or replace function public.rg_sms_receipt(p_event text,p_message text,p_phone text,p_kind text,p_parts integer default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rg_recipients; inserted uuid;
begin
 if p_kind not in('sms:sent','sms:delivered','sms:failed') or p_event is null or length(p_event)>120 or p_message is null or length(p_message)>100 then raise exception 'Invalid SMS receipt'; end if;
 select * into r from public.rg_recipients where message_id=p_message and phone=p_phone for update;
 insert into public.rg_events(external_id,kind,entity_id,detail)
 values(p_event,p_kind,p_message,jsonb_build_object('matched_recipient',r.id is not null,'parts_count',p_parts))
 on conflict(external_id) do nothing returning id into inserted;
 if inserted is null then return jsonb_build_object('accepted',true,'duplicate',true); end if;
 if r.id is null or r.status='suppressed' then return jsonb_build_object('accepted',true,'matched',false); end if;
 if p_kind='sms:failed' then
  update public.rg_recipients set status='failed',delivered_at=null,error=left(coalesce(p_reason,'Gateway delivery failure'),400) where id=r.id;
 elsif r.status<>'failed' then
  if p_kind='sms:sent' then
   if p_parts between 1 and 100 then
    if r.parts_expected is not null and r.parts_expected<>p_parts then raise exception 'Gateway part count changed'; end if;
    update public.rg_recipients set parts_expected=p_parts where id=r.id;
   end if;
   update public.rg_recipients set status='sent' where id=r.id and status in('unknown','accepted');
  else
   update public.rg_recipients set parts_delivered=parts_delivered+1 where id=r.id;
  end if;
  -- Aggregate GET Delivered is deliberately insufficient. Every expected part
  -- needs its own authenticated, deduplicated delivery callback.
  update public.rg_recipients set status='delivered',delivered_at=coalesce(delivered_at,now()),error=null
   where id=r.id and parts_expected is not null and parts_delivered=parts_expected and status in('unknown','accepted','sent');
 end if;
 select * into r from public.rg_recipients where id=r.id;
 return jsonb_build_object('accepted',true,'matched',true,'status',r.status,'parts_expected',r.parts_expected,'parts_delivered',r.parts_delivered);
end $$;
revoke all on function public.rg_sms_receipt(text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.rg_sms_receipt(text,text,text,text,integer,text) to service_role;
