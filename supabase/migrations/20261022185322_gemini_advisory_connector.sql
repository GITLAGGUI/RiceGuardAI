-- Private Gemini trial storage. This migration never publishes, reviews findings,
-- modifies operational rows, or schedules SMS. Owner pinning/MFA belongs to Edge.
create schema rg_mcp;
revoke all on schema rg_mcp from public, anon, authenticated;
grant usage on schema rg_mcp to service_role;

create table rg_mcp.clients (
  client_id text primary key check(length(client_id) between 1 and 128),
  owner_id uuid not null references public.profiles(id),
  client_name text not null check(length(client_name) between 1 and 100),
  redirect_uri text not null check(length(redirect_uri)<=2048 and redirect_uri ~ '^https://'),
  secret_hash text not null unique check(secret_hash ~ '^[0-9a-f]{64}$'),
  resource text not null default 'https://riceguardai.dev/api/advisory-mcp',
  scopes text[] not null default array['evidence:read','advisory:submit'],
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '90 days',
  revoked_at timestamptz,
  check(resource='https://riceguardai.dev/api/advisory-mcp'),
  check(cardinality(scopes)>0 and scopes <@ array['evidence:read','advisory:submit']::text[])
);
create table rg_mcp.requests (
  id uuid primary key,
  client_id text not null references rg_mcp.clients(client_id),
  owner_id uuid references public.profiles(id),
  redirect_uri text not null, resource text not null, scopes text[] not null,
  state text not null check(length(state) between 1 and 2048),
  challenge text not null check(length(challenge) between 43 and 128),
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  used_at timestamptz
);
create table rg_mcp.grants (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references rg_mcp.requests(id),
  client_id text not null references rg_mcp.clients(client_id),
  owner_id uuid not null references public.profiles(id),
  resource text not null, scopes text[] not null,
  allow_images boolean not null default false,
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  revoked_at timestamptz,
  code_hash text not null unique check(code_hash ~ '^[0-9a-f]{64}$'),
  code_expires_at timestamptz not null, code_used_at timestamptz,
  check(expires_at>created_at and expires_at<=created_at+interval '30 days'),
  check(cardinality(scopes)>0 and scopes <@ array['evidence:read','advisory:submit']::text[])
);
create table rg_mcp.tokens (
  token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
  grant_id uuid not null references rg_mcp.grants(id),
  kind text not null check(kind in ('access','refresh')),
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  rotated_at timestamptz, revoked_at timestamptz
);
create index rg_mcp_tokens_grant on rg_mcp.tokens(grant_id);
create table rg_mcp.survey_access (
  grant_id uuid not null references rg_mcp.grants(id),
  survey_id uuid not null references public.rg_surveys(id),
  revoked_at timestamptz,
  primary key(grant_id,survey_id)
);
create table rg_mcp.submissions (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references rg_mcp.grants(id),
  survey_id uuid not null references public.rg_surveys(id),
  job_id uuid not null references public.rg_processing_jobs(id),
  result_revision integer not null check(result_revision>=1),
  evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_binding_sha256 text not null check(evidence_binding_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_snapshot jsonb not null,
  idempotency_key text not null check(length(idempotency_key) between 16 and 128),
  payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  configured_task_model text,
  created_at timestamptz not null default now(),
  unique(grant_id,idempotency_key)
);
create table rg_mcp.rate_limits (
  bucket_hash text primary key check(bucket_hash ~ '^[0-9a-f]{64}$'),
  window_seconds integer not null, reset_at timestamptz not null,
  requests integer not null check(requests>0)
);
create table rg_mcp.audit (
  id uuid primary key default gen_random_uuid(), grant_id uuid references rg_mcp.grants(id),
  action text not null, survey_id uuid, result_revision integer,
  outcome text not null, created_at timestamptz not null default now()
);

-- RLS is defense in depth; service_role already bypasses it. No browser policies.
alter table rg_mcp.clients enable row level security;
alter table rg_mcp.requests enable row level security;
alter table rg_mcp.grants enable row level security;
alter table rg_mcp.tokens enable row level security;
alter table rg_mcp.survey_access enable row level security;
alter table rg_mcp.submissions enable row level security;
alter table rg_mcp.rate_limits enable row level security;
alter table rg_mcp.audit enable row level security;
revoke all on all tables in schema rg_mcp from public,anon,authenticated;
grant select,insert,update on rg_mcp.clients,rg_mcp.requests,rg_mcp.grants,
  rg_mcp.tokens,rg_mcp.survey_access,rg_mcp.rate_limits to service_role;
grant select,insert on rg_mcp.submissions,rg_mcp.audit to service_role;
grant select on public.profiles,public.rg_surveys,public.rg_processing_jobs,
  public.rg_result_revisions,public.rg_advisory_sources to service_role;
-- PostgreSQL requires UPDATE privilege on at least one column for FOR SHARE.
-- Only these existing row keys are granted; this connector never updates them.
grant update(id) on public.profiles,public.rg_surveys,public.rg_processing_jobs,
  public.rg_result_revisions,public.rg_advisory_sources to service_role;

create function rg_mcp.require_owner(p_owner uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.profiles where id=p_owner and role='admin' and is_active for share;
  if not found then raise exception 'Active connector owner required'; end if;
end $$;

create function rg_mcp.require_grant(p_id uuid,p_scope text default null)
returns rg_mcp.grants language plpgsql security invoker set search_path='' as $$
declare g rg_mcp.grants;
begin
  select * into g from rg_mcp.grants where id=p_id for update;
  if g.id is null or g.revoked_at is not null or g.expires_at<=now()
    or (p_scope is not null and not p_scope=any(g.scopes)) then
    raise exception 'Invalid or insufficient connector grant';
  end if;
  perform 1 from rg_mcp.clients c where c.client_id=g.client_id
    and c.owner_id=g.owner_id and c.resource=g.resource
    and c.revoked_at is null and c.expires_at>now() for share;
  if not found then raise exception 'Invalid connector client'; end if;
  perform rg_mcp.require_owner(g.owner_id);
  return g;
end $$;

-- Every value that can affect projection is bound, including full manifest,
-- pinned media fingerprints, source content (not only version) and context.
-- These internal rows are never an MCP response; Edge uses a strict whitelist.
create function rg_mcp.evidence_snapshot(p_grant uuid,p_survey uuid,p_job uuid,p_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.rg_surveys; r public.rg_result_revisions; j public.rg_processing_jobs;
  sources jsonb; snapshot jsonb;
begin
  perform 1 from rg_mcp.survey_access where grant_id=p_grant and survey_id=p_survey
    and revoked_at is null for share;
  if not found then raise exception 'Survey is outside the connector grant'; end if;
  select * into s from public.rg_surveys where id=p_survey for share;
  if s.id is null or s.archived_at is not null or s.active_result_revision is distinct from p_revision
    then raise exception 'Stale or archived evidence'; end if;
  select * into r from public.rg_result_revisions
    where survey_id=p_survey and job_id=p_job and revision=p_revision for share;
  select * into j from public.rg_processing_jobs where id=p_job and survey_id=p_survey for share;
  if r.id is null or j.id is null or j.result_manifest is null
    or r.manifest is distinct from j.result_manifest
    or r.manifest->>'schema_version' is distinct from 'riceguard.result.v2'
    then raise exception 'Unavailable or stale evidence'; end if;
  -- Lock active guidance before its snapshot is read, preventing an in-place
  -- edit/deactivation from slipping between this check and the private insert.
  perform 1 from public.rg_advisory_sources a where a.active for share;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) into sources
    from public.rg_advisory_sources a where a.active and a.disease in (
      select finding->>'disease' from jsonb_array_elements(r.manifest->'assets') asset,
        jsonb_array_elements(asset->'diseases') finding where finding->>'status'='detected'
    );
  snapshot:=jsonb_build_object('revision',to_jsonb(r),'job',to_jsonb(j),
    'survey',to_jsonb(s),'guidance',sources);
  return snapshot || jsonb_build_object('evidence_binding_sha256',
    encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'));
end $$;

create function public.rg_mcp_store(p_operation text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  c rg_mcp.clients; q rg_mcp.requests; g rg_mcp.grants; t rg_mcp.tokens;
  saved rg_mcp.submissions; bucket rg_mcp.rate_limits;
  owner uuid; selected uuid[]; requested text[]; item uuid; snapshot jsonb;
  expires timestamptz; code_expires timestamptz; output jsonb; rows jsonb;
  page_limit integer; window_size integer; max_requests integer;
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Invalid connector input'; end if;
  if p_operation='register_client' then
    owner:=(p_input->>'owner_id')::uuid; perform rg_mcp.require_owner(owner);
    if p_input->>'redirect_uri' !~ '^https://[^/@?#[:space:]]+(/[^#[:space:]]*)?$'
      or p_input->>'redirect_uri' ~ '[@#]' then raise exception 'Invalid registered redirect'; end if;
    insert into rg_mcp.clients(client_id,owner_id,client_name,redirect_uri,secret_hash)
      values(p_input->>'client_id',owner,p_input->>'client_name',p_input->>'redirect_uri',p_input->>'secret_hash') returning * into c;
    return jsonb_build_object('client_id',c.client_id,'client_name',c.client_name,'redirect_uri',c.redirect_uri,'scopes',c.scopes);

  elsif p_operation='create_request' then
    select * into c from rg_mcp.clients where client_id=p_input->>'client_id' for share;
    if c.client_id is null or c.revoked_at is not null or c.expires_at<=now()
      or c.redirect_uri is distinct from p_input->>'redirect_uri'
      or c.resource is distinct from p_input->>'resource' then raise exception 'Invalid authorization request'; end if;
    perform rg_mcp.require_owner(c.owner_id);
    select array_agg(value) into requested from jsonb_array_elements_text(p_input->'scopes');
    expires:=(p_input->>'expires_at')::timestamptz;
    if requested is null or cardinality(requested)=0 or not requested<@c.scopes
      or expires is null or expires<=now() or expires>now()+interval '5 minutes'
      then raise exception 'Invalid authorization request'; end if;
    insert into rg_mcp.requests(id,client_id,redirect_uri,resource,scopes,state,challenge,expires_at)
      values((p_input->>'request_id')::uuid,c.client_id,c.redirect_uri,c.resource,requested,p_input->>'state',p_input->>'challenge',expires) returning * into q;
    return jsonb_build_object('request_id',q.id,'expires_at',q.expires_at,'client_id',c.client_id,
      'client_name',c.client_name,'redirect_uri',c.redirect_uri,'scopes',q.scopes);

  elsif p_operation in ('preview_consent','complete_consent') then
    owner:=(p_input->>'owner_id')::uuid; perform rg_mcp.require_owner(owner);
    select * into q from rg_mcp.requests where id=(p_input->>'request_id')::uuid for update;
    select * into c from rg_mcp.clients where client_id=q.client_id for share;
    if q.id is null or q.used_at is not null or q.expires_at<=now()
      or c.owner_id is distinct from owner or (q.owner_id is not null and q.owner_id<>owner)
      or c.revoked_at is not null or c.expires_at<=now()
      or c.resource<>q.resource or c.redirect_uri<>q.redirect_uri
      then raise exception 'Invalid or expired consent request'; end if;
    if p_operation='preview_consent' then
      update rg_mcp.requests set owner_id=owner where id=q.id;
      select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.name) order by s.id),'[]'::jsonb)
        into rows from public.rg_surveys s where s.archived_at is null and exists(
          select 1 from public.rg_result_revisions r join public.rg_processing_jobs j on j.id=r.job_id
          where r.survey_id=s.id and r.revision=s.active_result_revision and j.survey_id=s.id
            and j.result_manifest=r.manifest);
      return jsonb_build_object('app_name',c.client_name,'scopes',q.scopes,'expires_at',q.expires_at,'eligible_surveys',rows);
    end if;
    if q.owner_id is distinct from owner then raise exception 'Consent preview required'; end if;
    if p_input->>'decision'='deny' then
      update rg_mcp.requests set used_at=now() where id=q.id;
      return jsonb_build_object('redirect_uri',q.redirect_uri,'state',q.state,'grant_id',null,'allowed',false);
    end if;
    if p_input->>'decision' is distinct from 'allow' then raise exception 'Invalid consent decision'; end if;
    select array_agg(value::uuid) into selected from jsonb_array_elements_text(p_input->'survey_ids');
    expires:=(p_input->>'grant_expires_at')::timestamptz; code_expires:=(p_input->>'code_expires_at')::timestamptz;
    if selected is null or cardinality(selected) not between 1 and 100
      or cardinality(selected)<>(select count(distinct x) from unnest(selected) x)
      or expires is null or expires<=now() or expires>now()+interval '30 days'
      or expires>c.expires_at or code_expires is null or code_expires<=now()
      or code_expires>now()+interval '5 minutes' or code_expires>expires
      then raise exception 'Invalid consent selection or expiry'; end if;
    foreach item in array selected loop
      perform 1 from public.rg_surveys s where s.id=item and s.archived_at is null
        and exists(select 1 from public.rg_result_revisions r join public.rg_processing_jobs j on j.id=r.job_id
          where r.survey_id=s.id and r.revision=s.active_result_revision and j.survey_id=s.id
            and j.result_manifest=r.manifest) for share;
      if not found then raise exception 'Invalid consent survey'; end if;
    end loop;
    insert into rg_mcp.grants(request_id,client_id,owner_id,resource,scopes,allow_images,expires_at,code_hash,code_expires_at)
      values(q.id,q.client_id,owner,q.resource,q.scopes,coalesce((p_input->>'allow_images')::boolean,false),expires,p_input->>'code_hash',code_expires) returning * into g;
    insert into rg_mcp.survey_access(grant_id,survey_id) select g.id,x from unnest(selected) x;
    update rg_mcp.requests set used_at=now() where id=q.id;
    insert into rg_mcp.audit(grant_id,action,outcome) values(g.id,'consent','allowed');
    return jsonb_build_object('redirect_uri',q.redirect_uri,'state',q.state,'grant_id',g.id,'allowed',true);

  elsif p_operation in ('exchange_code','rotate_refresh') then
    select * into c from rg_mcp.clients where client_id=p_input->>'client_id' for share;
    if c.client_id is null or c.secret_hash is distinct from p_input->>'client_secret_hash'
      or c.resource is distinct from p_input->>'resource' or c.revoked_at is not null or c.expires_at<=now()
      then raise exception 'Invalid client credentials or resource'; end if;
    if p_operation='exchange_code' then
      select * into g from rg_mcp.grants where code_hash=p_input->>'code_hash' and client_id=c.client_id for update;
      if g.id is null then raise exception 'Invalid authorization code'; end if;
      g:=rg_mcp.require_grant(g.id);
      select * into q from rg_mcp.requests where id=g.request_id;
      if g.code_used_at is not null or g.code_expires_at<=now()
        or q.challenge is distinct from p_input->>'challenge'
        or q.redirect_uri is distinct from p_input->>'redirect_uri'
        or g.resource is distinct from p_input->>'resource' then raise exception 'Invalid authorization code'; end if;
    else
      -- Never delete rotated hashes: a later reuse must still locate its family.
      select * into t from rg_mcp.tokens where token_hash=p_input->>'old_refresh_hash' and kind='refresh';
      if t.token_hash is null then raise exception 'Invalid refresh token'; end if;
      select * into g from rg_mcp.grants where id=t.grant_id for update;
      select * into t from rg_mcp.tokens where token_hash=p_input->>'old_refresh_hash' for update;
      if g.client_id<>c.client_id or g.resource<>c.resource then raise exception 'Invalid refresh token'; end if;
      if t.rotated_at is not null then
        update rg_mcp.grants set revoked_at=coalesce(revoked_at,now()) where id=g.id;
        update rg_mcp.tokens set revoked_at=coalesce(revoked_at,now()) where grant_id=g.id;
        insert into rg_mcp.audit(grant_id,action,outcome) values(g.id,'refresh','reuse_revoked');
        -- RAISE would roll back the revocation. The adapter throws AFTER commit.
        return jsonb_build_object('error','invalid_grant');
      end if;
      g:=rg_mcp.require_grant(g.id);
      if t.revoked_at is not null or t.expires_at<=now() then raise exception 'Invalid refresh token'; end if;
    end if;
    expires:=(p_input->>'access_expires_at')::timestamptz;
    if expires is null or expires<=now() or expires>now()+interval '1 hour'
      or p_input->>'access_hash'=p_input->>'refresh_hash'
      then raise exception 'Invalid token expiration'; end if;
    expires:=least(expires,g.expires_at);
    if p_operation='exchange_code' then
      update rg_mcp.grants set code_used_at=now() where id=g.id;
    else
      update rg_mcp.tokens set rotated_at=now() where token_hash=t.token_hash;
      update rg_mcp.tokens set revoked_at=coalesce(revoked_at,now()) where grant_id=g.id and kind='access';
    end if;
    insert into rg_mcp.tokens(token_hash,grant_id,kind,expires_at)
      values(p_input->>'access_hash',g.id,'access',expires),(p_input->>'refresh_hash',g.id,'refresh',g.expires_at);
    insert into rg_mcp.audit(grant_id,action,outcome) values(g.id,p_operation,'issued');
    return jsonb_build_object('grant_id',g.id,'scopes',g.scopes,'grant_expires_at',g.expires_at);

  elsif p_operation='access_context' then
    select * into t from rg_mcp.tokens where token_hash=p_input->>'access_hash' and kind='access';
    if t.token_hash is null or t.revoked_at is not null or t.expires_at<=now() then raise exception 'Invalid access token'; end if;
    g:=rg_mcp.require_grant(t.grant_id);
    if g.resource is distinct from p_input->>'resource' then raise exception 'Wrong token resource'; end if;
    -- Recheck after obtaining the grant lock (refresh/revoke may have won it).
    select * into t from rg_mcp.tokens where token_hash=t.token_hash;
    if t.revoked_at is not null or t.expires_at<=now() then raise exception 'Invalid access token'; end if;
    return jsonb_build_object('grant_id',g.id,'owner_id',g.owner_id,'scopes',g.scopes,'allow_images',g.allow_images,'expires_at',g.expires_at);

  elsif p_operation='revoke' then
    if p_input->>'mode'='owner' then
      owner:=(p_input->>'owner_id')::uuid; perform rg_mcp.require_owner(owner);
      select * into g from rg_mcp.grants where id=(p_input->>'grant_id')::uuid and owner_id=owner for update;
    elsif p_input->>'mode'='client' then
      select * into c from rg_mcp.clients where client_id=p_input->>'client_id'
        and secret_hash=p_input->>'client_secret_hash' and revoked_at is null and expires_at>now() for share;
      if c.client_id is null then raise exception 'Invalid client credentials'; end if;
      select grant_row.* into g from rg_mcp.grants grant_row join rg_mcp.tokens token_row on token_row.grant_id=grant_row.id
        where token_row.token_hash=p_input->>'token_hash' and grant_row.client_id=c.client_id for update of grant_row;
    else raise exception 'Invalid revocation mode'; end if;
    if g.id is not null then
      update rg_mcp.grants set revoked_at=coalesce(revoked_at,now()) where id=g.id;
      update rg_mcp.tokens set revoked_at=coalesce(revoked_at,now()) where grant_id=g.id;
      insert into rg_mcp.audit(grant_id,action,outcome) values(g.id,'revoke','revoked');
    end if;
    return jsonb_build_object('revoked',true);

  elsif p_operation='owner_grants' then
    owner:=(p_input->>'owner_id')::uuid; perform rg_mcp.require_owner(owner);
    select coalesce(jsonb_agg(jsonb_build_object('id',g1.id,'app_name',c1.client_name,'scopes',g1.scopes,
      'allow_images',g1.allow_images,'expires_at',g1.expires_at,'revoked_at',g1.revoked_at,
      'survey_ids',coalesce((select jsonb_agg(a.survey_id order by a.survey_id) from rg_mcp.survey_access a
        where a.grant_id=g1.id and a.revoked_at is null),'[]'::jsonb)) order by g1.created_at desc),'[]'::jsonb)
      into rows from rg_mcp.grants g1 join rg_mcp.clients c1 on c1.client_id=g1.client_id where g1.owner_id=owner;
    return jsonb_build_object('grants',rows);

  elsif p_operation in ('queue_summary','list_evidence','read_evidence','save_submission') then
    g:=rg_mcp.require_grant((p_input->>'grant_id')::uuid,
      case when p_operation='save_submission' then 'advisory:submit' else 'evidence:read' end);
    if p_operation='queue_summary' then
      select jsonb_build_object('ready',count(*) filter(where s.active_result_revision is not null and exists(
          select 1 from public.rg_result_revisions r join public.rg_processing_jobs j on j.id=r.job_id
          where r.survey_id=s.id and r.revision=s.active_result_revision and j.survey_id=s.id and j.result_manifest=r.manifest)),
        'awaiting',count(*) filter(where s.active_result_revision is null),
        'returned',count(*) filter(where s.status in ('Returned','Failed')),'checked_at',now()) into output
        from rg_mcp.survey_access a join public.rg_surveys s on s.id=a.survey_id
        where a.grant_id=g.id and a.revoked_at is null and s.archived_at is null;
      return output;
    elsif p_operation='list_evidence' then
      page_limit:=(p_input->>'limit')::integer;
      if page_limit is null or page_limit not between 1 and 20 then raise exception 'Invalid evidence page limit'; end if;
      select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at,page.id),'[]'::jsonb) into rows from (
        select r.id,r.created_at,r.survey_id,r.job_id,r.revision as result_revision
        from public.rg_result_revisions r join public.rg_surveys s on s.id=r.survey_id
          join public.rg_processing_jobs j on j.id=r.job_id and j.survey_id=s.id
          join rg_mcp.survey_access a on a.survey_id=s.id and a.grant_id=g.id
        where a.revoked_at is null and s.archived_at is null and s.active_result_revision=r.revision
          and j.result_manifest=r.manifest and (p_input->'after' is null or p_input->'after'='null'::jsonb
            or (r.created_at,r.id)>((p_input#>>'{after,created_at}')::timestamptz,(p_input#>>'{after,id}')::uuid))
        order by r.created_at,r.id limit page_limit+1
      ) page;
      output:=case when jsonb_array_length(rows)>page_limit then
        jsonb_build_object('created_at',rows->(page_limit-1)->'created_at','id',rows->(page_limit-1)->'id') else 'null'::jsonb end;
      if jsonb_array_length(rows)>page_limit then rows:=rows-page_limit; end if;
      return jsonb_build_object('revisions',rows,'next',output);
    end if;
    snapshot:=rg_mcp.evidence_snapshot(g.id,(p_input->>'survey_id')::uuid,(p_input->>'job_id')::uuid,(p_input->>'result_revision')::integer);
    if p_operation='read_evidence' then
      insert into rg_mcp.audit(grant_id,action,survey_id,result_revision,outcome)
        values(g.id,p_operation,(p_input->>'survey_id')::uuid,(p_input->>'result_revision')::integer,'read');
      return snapshot;
    end if;
    if snapshot->>'evidence_binding_sha256' is distinct from p_input->>'evidence_binding_sha256'
      then raise exception 'Stale evidence binding'; end if;
    if coalesce(p_input->>'evidence_sha256','') !~ '^[0-9a-f]{64}$'
      or coalesce(p_input->>'payload_sha256','') !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_input->'payload') is distinct from 'object'
      then raise exception 'Invalid advisory evidence or payload'; end if;
    select * into saved from rg_mcp.submissions where grant_id=g.id and idempotency_key=p_input->>'idempotency_key';
    if saved.id is not null then
      if saved.survey_id<>(p_input->>'survey_id')::uuid or saved.job_id<>(p_input->>'job_id')::uuid
        or saved.result_revision<>(p_input->>'result_revision')::integer
        or saved.evidence_sha256<>p_input->>'evidence_sha256'
        or saved.evidence_binding_sha256<>p_input->>'evidence_binding_sha256'
        or saved.payload_sha256<>p_input->>'payload_sha256' or saved.payload<>p_input->'payload'
        then raise exception 'Idempotency conflict'; end if;
      return jsonb_build_object('submission_id',saved.id,'status','stored_private','duplicate',true,'public_post_created',false,'sms_enqueued',false);
    end if;
    if jsonb_typeof(p_input#>'{payload,source_ids}') is distinct from 'array'
      or jsonb_array_length(p_input#>'{payload,source_ids}') not between 1 and 20
      or exists(select 1 from jsonb_array_elements_text(p_input#>'{payload,source_ids}') source
        where not exists(select 1 from jsonb_array_elements(snapshot->'guidance') approved where approved->>'id'=source))
      then raise exception 'Invalid approved source IDs'; end if;
    insert into rg_mcp.submissions(grant_id,survey_id,job_id,result_revision,evidence_sha256,evidence_binding_sha256,
      evidence_snapshot,idempotency_key,payload_sha256,payload)
      values(g.id,(p_input->>'survey_id')::uuid,(p_input->>'job_id')::uuid,(p_input->>'result_revision')::integer,
        p_input->>'evidence_sha256',p_input->>'evidence_binding_sha256',snapshot,p_input->>'idempotency_key',p_input->>'payload_sha256',p_input->'payload') returning * into saved;
    insert into rg_mcp.audit(grant_id,action,survey_id,result_revision,outcome)
      values(g.id,'save_submission',saved.survey_id,saved.result_revision,'stored_private');
    return jsonb_build_object('submission_id',saved.id,'status','stored_private','duplicate',false,'public_post_created',false,'sms_enqueued',false);

  elsif p_operation='rate_limit' then
    window_size:=(p_input->>'window_seconds')::integer; max_requests:=(p_input->>'max_requests')::integer;
    if window_size is null or window_size not between 1 and 3600 or max_requests is null or max_requests not between 1 and 120
      then raise exception 'Invalid rate limit'; end if;
    insert into rg_mcp.rate_limits(bucket_hash,window_seconds,reset_at,requests)
      values(p_input->>'bucket_hash',window_size,now()+make_interval(secs=>window_size),1)
      on conflict(bucket_hash) do update set
        requests=case when rg_mcp.rate_limits.reset_at<=now() then 1 else rg_mcp.rate_limits.requests+1 end,
        reset_at=case when rg_mcp.rate_limits.reset_at<=now() then now()+make_interval(secs=>window_size) else rg_mcp.rate_limits.reset_at end,
        window_seconds=window_size returning * into bucket;
    return jsonb_build_object('allowed',bucket.requests<=max_requests,
      'retry_after_seconds',case when bucket.requests<=max_requests then 0 else greatest(1,ceil(extract(epoch from bucket.reset_at-now()))::integer) end);
  end if;
  raise exception 'Unknown connector operation';
end $$;

revoke all on all functions in schema rg_mcp from public,anon,authenticated;
grant execute on function rg_mcp.require_owner(uuid),rg_mcp.require_grant(uuid,text),
  rg_mcp.evidence_snapshot(uuid,uuid,uuid,integer) to service_role;
revoke all on function public.rg_mcp_store(text,jsonb) from public,anon,authenticated;
grant execute on function public.rg_mcp_store(text,jsonb) to service_role;
