-- Private readiness metadata only. No recipients, credentials, media, sender,
-- scheduler or email transport is created by this migration.
-- A lease cannot guarantee exactly-once SMTP delivery: transport success followed
-- by a lost acknowledgement can cause a retry to send another notification.
-- Stable event identity and advisory submission idempotency are separate guards.
create table rg_mcp.ready_events (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null, job_id uuid not null,
  result_revision integer not null check(result_revision>=1),
  policy_version text not null check(policy_version='visual-v1'),
  catalogue_sha256 text not null check(catalogue_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check(status in ('pending','leased','notified','failed')),
  lease_id uuid, lease_expires_at timestamptz,
  notice_attempts integer not null default 0 check(notice_attempts between 0 and 5),
  provider_receipt text check(provider_receipt ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
  failure_code text check(failure_code in ('transport_timeout','transport_unavailable','provider_rejected','unknown_failure','manual_reconciliation')),
  created_at timestamptz not null default now(), notified_at timestamptz,
  unique(survey_id,job_id,result_revision,policy_version),
  foreign key(survey_id,job_id,result_revision)
    references rg_mcp.visual_catalogues(survey_id,job_id,result_revision),
  check((status='pending' and lease_id is null and lease_expires_at is null and notice_attempts=0 and provider_receipt is null and notified_at is null and failure_code is null)
    or (status='leased' and lease_id is not null and lease_expires_at is not null and notice_attempts>0 and provider_receipt is null and notified_at is null and failure_code is null)
    or (status='failed' and lease_id is not null and lease_expires_at is not null and notice_attempts>0 and provider_receipt is null and notified_at is null and failure_code is not null)
    or (status='notified' and lease_id is not null and lease_expires_at is not null and notice_attempts>0 and provider_receipt is not null and notified_at is not null and failure_code is null))
);
alter table rg_mcp.ready_events enable row level security;
revoke all on rg_mcp.ready_events from public,anon,authenticated;
grant select,insert on rg_mcp.ready_events to service_role;
grant update(status,lease_id,lease_expires_at,notice_attempts,provider_receipt,failure_code,notified_at)
  on rg_mcp.ready_events to service_role;

create function rg_mcp.keep_ready_event_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.id is distinct from old.id or new.survey_id is distinct from old.survey_id
    or new.job_id is distinct from old.job_id or new.result_revision is distinct from old.result_revision
    or new.policy_version is distinct from old.policy_version or new.catalogue_sha256 is distinct from old.catalogue_sha256
    or new.created_at is distinct from old.created_at then raise exception 'Immutable ready event identity'; end if;
  return new;
end $$;
create trigger ready_event_identity before update on rg_mcp.ready_events
for each row execute function rg_mcp.keep_ready_event_identity();

-- Lock and recheck actual consent, owner/client, scope and survey access through
-- the existing connector guards; then validate the entire current catalogue.
create function rg_mcp.ready_event_source(p_survey uuid,p_job uuid,p_revision integer,p_policy text)
returns text language plpgsql security invoker set search_path='' as $$
declare selected uuid; g rg_mcp.grants; c rg_mcp.visual_catalogues;
begin
  if p_policy is distinct from 'visual-v1' then raise exception 'Invalid ready event policy'; end if;
  perform rg_mcp.visual_source(p_survey,p_job,p_revision);
  select * into c from rg_mcp.visual_catalogues
    where survey_id=p_survey and job_id=p_job and result_revision=p_revision;
  if c.catalogue is null then raise exception 'Ready event catalogue unavailable'; end if;
  perform rg_mcp.validate_visual_catalogue(c.catalogue);
  select grant_row.id into selected from rg_mcp.grants grant_row
    join rg_mcp.survey_access access_row on access_row.grant_id=grant_row.id
    join rg_mcp.clients client_row on client_row.client_id=grant_row.client_id
    join public.profiles owner_row on owner_row.id=grant_row.owner_id
    where access_row.survey_id=p_survey and access_row.revoked_at is null
      and grant_row.allow_images and grant_row.revoked_at is null and grant_row.expires_at>now()
      and array['evidence:read','advisory:submit']::text[] <@ grant_row.scopes
      and client_row.owner_id=grant_row.owner_id and client_row.resource=grant_row.resource
      and client_row.revoked_at is null and client_row.expires_at>now()
      and owner_row.role='admin' and owner_row.is_active
    order by grant_row.id limit 1;
  -- No grant is normal before an owner authorizes the connector. Source errors
  -- above still fail; readiness metadata must never disguise invalid evidence.
  if selected is null then return null; end if;
  g:=rg_mcp.require_grant(selected,'evidence:read');
  perform rg_mcp.require_grant(selected,'advisory:submit');
  if not g.allow_images then raise exception 'Image consent required for ready event'; end if;
  perform rg_mcp.evidence_snapshot(g.id,p_survey,p_job,p_revision);
  return c.catalogue_sha256;
end $$;

create function public.rg_mcp_event_store(p_operation text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e rg_mcp.ready_events; g rg_mcp.grants; c rg_mcp.visual_catalogues;
  survey uuid; job uuid; revision integer; digest text; inserted integer;
  token uuid; receipt text; failure text;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid ready event input'; end if;
  if p_operation='enqueue_ready' then
    if not p_input ?& array['survey_id','job_id','result_revision','policy_version']
      or p_input-array['survey_id','job_id','result_revision','policy_version']<>'{}'::jsonb
      or jsonb_typeof(p_input->'survey_id') is distinct from 'string'
      or jsonb_typeof(p_input->'job_id') is distinct from 'string'
      or jsonb_typeof(p_input->'result_revision') is distinct from 'number'
      or p_input->>'result_revision' !~ '^[1-9][0-9]{0,8}$'
      or p_input->>'policy_version' is distinct from 'visual-v1' then raise exception 'Invalid ready event key'; end if;
    survey:=(p_input->>'survey_id')::uuid; job:=(p_input->>'job_id')::uuid;
    revision:=(p_input->>'result_revision')::integer;
    digest:=rg_mcp.ready_event_source(survey,job,revision,p_input->>'policy_version');
    if digest is null then
      return jsonb_build_object('event_id',null,'status','awaiting_authorization','duplicate',false);
    end if;
    insert into rg_mcp.ready_events(survey_id,job_id,result_revision,policy_version,catalogue_sha256)
      values(survey,job,revision,'visual-v1',digest) on conflict do nothing;
    get diagnostics inserted=row_count;
    select * into e from rg_mcp.ready_events
      where survey_id=survey and job_id=job and result_revision=revision and policy_version='visual-v1';
    if e.catalogue_sha256 is distinct from digest then raise exception 'Stale ready event catalogue'; end if;
    return jsonb_build_object('event_id',e.id,'status',e.status,'duplicate',inserted=0);
  elsif p_operation='resolve_event' then
    if not p_input ?& array['grant_id','event_id'] or p_input-array['grant_id','event_id']<>'{}'::jsonb
      or jsonb_typeof(p_input->'grant_id') is distinct from 'string'
      or jsonb_typeof(p_input->'event_id') is distinct from 'string' then raise exception 'Invalid ready event resolution'; end if;
    g:=rg_mcp.require_grant((p_input->>'grant_id')::uuid,'evidence:read');
    if not g.allow_images then raise exception 'Image consent required for ready event'; end if;
    select * into e from rg_mcp.ready_events where id=(p_input->>'event_id')::uuid;
    if e.id is null then raise exception 'Ready event unavailable'; end if;
    perform rg_mcp.evidence_snapshot(g.id,e.survey_id,e.job_id,e.result_revision);
    select * into c from rg_mcp.visual_catalogues
      where survey_id=e.survey_id and job_id=e.job_id and result_revision=e.result_revision;
    if c.catalogue is null or c.catalogue_sha256 is distinct from e.catalogue_sha256
      then raise exception 'Stale ready event catalogue'; end if;
    perform rg_mcp.validate_visual_catalogue(c.catalogue);
    return jsonb_build_object('event_id',e.id,'survey_id',e.survey_id,'job_id',e.job_id,
      'result_revision',e.result_revision,'policy_version',e.policy_version,
      'catalogue_sha256',e.catalogue_sha256,'status',e.status);
  elsif p_operation in ('claim_notice','ack_notice','record_failed') then
    if not p_input ?& array['event_id','lease_id']
      or jsonb_typeof(p_input->'event_id') is distinct from 'string'
      or jsonb_typeof(p_input->'lease_id') is distinct from 'string'
      or (p_operation='claim_notice' and p_input-array['event_id','lease_id']<>'{}'::jsonb)
      or (p_operation='ack_notice' and p_input-array['event_id','lease_id','provider_receipt']<>'{}'::jsonb)
      or (p_operation='record_failed' and p_input-array['event_id','lease_id','failure_code']<>'{}'::jsonb)
      then raise exception 'Invalid ready event notice input'; end if;
    token:=(p_input->>'lease_id')::uuid;
    select * into e from rg_mcp.ready_events where id=(p_input->>'event_id')::uuid for update;
    if e.id is null then raise exception 'Ready event unavailable'; end if;
    if p_operation='claim_notice' then
      digest:=rg_mcp.ready_event_source(e.survey_id,e.job_id,e.result_revision,e.policy_version);
      if digest is null then raise exception 'No active image and advisory grant for ready event'; end if;
      if digest is distinct from e.catalogue_sha256 then raise exception 'Stale ready event catalogue'; end if;
      if e.status='notified' then
        return jsonb_build_object('event_id',e.id,'status','notified','lease_id',null,'lease_expires_at',null);
      elsif e.status='leased' and e.lease_expires_at>now() then
        if e.lease_id is distinct from token then raise exception 'Ready event notice lease is busy'; end if;
      else
        if e.lease_id=token then raise exception 'Expired or failed notice lease requires a new token'; end if;
        if e.notice_attempts>=5 then raise exception 'Ready event notice attempt limit reached'; end if;
        update rg_mcp.ready_events set status='leased',lease_id=token,lease_expires_at=now()+interval '5 minutes',
          notice_attempts=notice_attempts+1,failure_code=null where id=e.id returning * into e;
      end if;
      return jsonb_build_object('event_id',e.id,'status',e.status,'lease_id',e.lease_id,'lease_expires_at',e.lease_expires_at);
    elsif p_operation='ack_notice' then
      receipt:=p_input->>'provider_receipt';
      if jsonb_typeof(p_input->'provider_receipt') is distinct from 'string'
        or receipt !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$' then raise exception 'Invalid notice provider receipt'; end if;
      if e.status='notified' and e.lease_id=token and e.provider_receipt=receipt then
        return jsonb_build_object('event_id',e.id,'status','notified');
      end if;
      if e.status<>'leased' or e.lease_id is distinct from token or e.lease_expires_at<=now()
        then raise exception 'Invalid or expired notice lease'; end if;
      update rg_mcp.ready_events set status='notified',provider_receipt=receipt,notified_at=now()
        where id=e.id;
      return jsonb_build_object('event_id',e.id,'status','notified');
    else
      failure:=p_input->>'failure_code';
      if jsonb_typeof(p_input->'failure_code') is distinct from 'string'
        or failure not in ('transport_timeout','transport_unavailable','provider_rejected','unknown_failure','manual_reconciliation')
        then raise exception 'Invalid notice failure code'; end if;
      if e.status='failed' and e.lease_id=token and e.failure_code=failure then
        return jsonb_build_object('event_id',e.id,'status','failed');
      end if;
      if e.status<>'leased' or e.lease_id is distinct from token or e.lease_expires_at<=now()
        then raise exception 'Invalid or expired notice lease'; end if;
      update rg_mcp.ready_events set status='failed',failure_code=failure where id=e.id;
      return jsonb_build_object('event_id',e.id,'status','failed');
    end if;
  end if;
  raise exception 'Unsupported ready event operation';
end $$;

revoke all on function rg_mcp.keep_ready_event_identity(),rg_mcp.ready_event_source(uuid,uuid,integer,text)
  from public,anon,authenticated;
grant execute on function rg_mcp.keep_ready_event_identity(),rg_mcp.ready_event_source(uuid,uuid,integer,text)
  to service_role;
revoke all on function public.rg_mcp_event_store(text,jsonb) from public,anon,authenticated;
grant execute on function public.rg_mcp_event_store(text,jsonb) to service_role;
