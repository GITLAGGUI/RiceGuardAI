-- One private automatic visual result per processing identity, across model
-- wording, caller keys and renewed consent grants. The legacy manual RPC stays
-- unchanged. This prospective guard does not reconcile historical submissions.
create table rg_mcp.visual_submissions (
  survey_id uuid not null,
  job_id uuid not null,
  result_revision integer not null check(result_revision>=1),
  policy_version text not null check(policy_version ~ '^visual-v[1-9][0-9]*$'),
  owner_id uuid not null references public.profiles(id),
  submission_id uuid not null unique references rg_mcp.submissions(id),
  evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_binding_sha256 text not null check(evidence_binding_sha256 ~ '^[0-9a-f]{64}$'),
  catalogue_sha256 text not null check(catalogue_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key(survey_id,job_id,result_revision,policy_version),
  foreign key(survey_id,job_id,result_revision)
    references rg_mcp.visual_catalogues(survey_id,job_id,result_revision)
);
alter table rg_mcp.visual_submissions enable row level security;
revoke all on rg_mcp.visual_submissions from public,anon,authenticated;
grant select,insert on rg_mcp.visual_submissions to service_role;
create trigger immutable_visual_submission before update or delete on rg_mcp.visual_submissions
for each row execute function rg_mcp.reject_visual_mutation();

create function public.rg_mcp_visual_submission_store(p_operation text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g rg_mcp.grants; snapshot jsonb; catalogue rg_mcp.visual_catalogues;
  saved rg_mcp.visual_submissions; receipt jsonb; survey uuid; job uuid;
  revision integer; policy text; identity_key text;
begin
  if p_operation is distinct from 'save_submission' or jsonb_typeof(p_input) is distinct from 'object'
    then raise exception 'Unsupported visual submission operation'; end if;
  g:=rg_mcp.require_grant((p_input->>'grant_id')::uuid,'advisory:submit');
  if jsonb_typeof(p_input->'survey_id') is distinct from 'string'
    or jsonb_typeof(p_input->'job_id') is distinct from 'string'
    or jsonb_typeof(p_input->'result_revision') is distinct from 'number'
    or p_input->>'result_revision' !~ '^[1-9][0-9]{0,8}$'
    then raise exception 'Invalid visual submission key'; end if;
  survey:=(p_input->>'survey_id')::uuid; job:=(p_input->>'job_id')::uuid;
  revision:=(p_input->>'result_revision')::integer; policy:=p_input->>'policy_version';
  if policy is null or policy !~ '^visual-v[1-9][0-9]*$'
    then raise exception 'Invalid visual submission policy'; end if;
  identity_key:=survey::text||':'||job::text||':'||revision::text||':'||policy;
  -- Serialize even the first insert across different grants. Hash collisions
  -- merely serialize unrelated identities; the composite PK is authoritative.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(identity_key,0));
  snapshot:=rg_mcp.evidence_snapshot(g.id,survey,job,revision);
  if snapshot->>'evidence_binding_sha256' is distinct from p_input->>'evidence_binding_sha256'
    then raise exception 'Stale evidence binding'; end if;
  select * into catalogue from rg_mcp.visual_catalogues
    where survey_id=survey and job_id=job and result_revision=revision;
  if catalogue.catalogue->>'policy_version' is distinct from policy
    then raise exception 'Unavailable visual submission policy'; end if;
  -- This validates the current exact source/catalogue, image consent, read
  -- scope and ALL delivery receipts under this grant, including renewed grants.
  perform public.rg_mcp_visual_store('assert_delivery',p_input);
  if coalesce(p_input->>'evidence_sha256','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_input->>'payload_sha256','') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_input->'payload') is distinct from 'object'
    then raise exception 'Invalid advisory evidence or payload'; end if;
  select * into saved from rg_mcp.visual_submissions
    where survey_id=survey and job_id=job and result_revision=revision and policy_version=policy;
  if saved.submission_id is not null then
    if saved.owner_id is distinct from g.owner_id then raise exception 'Visual submission owner conflict'; end if;
    if saved.evidence_sha256 is distinct from p_input->>'evidence_sha256'
      or saved.evidence_binding_sha256 is distinct from p_input->>'evidence_binding_sha256'
      or saved.catalogue_sha256 is distinct from p_input->>'catalogue_sha256'
      then raise exception 'Stale visual submission evidence'; end if;
    -- Generated text can vary on retries; the first accepted payload wins.
    return jsonb_build_object('submission_id',saved.submission_id,'status','stored_private',
      'duplicate',true,'public_post_created',false,'sms_enqueued',false);
  end if;
  receipt:=public.rg_mcp_store('save_submission',p_input||jsonb_build_object(
    'idempotency_key','visual:'||encode(sha256(convert_to(identity_key,'UTF8')),'hex')));
  insert into rg_mcp.visual_submissions(survey_id,job_id,result_revision,policy_version,owner_id,
    submission_id,evidence_sha256,evidence_binding_sha256,catalogue_sha256)
    values(survey,job,revision,policy,g.owner_id,(receipt->>'submission_id')::uuid,
      p_input->>'evidence_sha256',p_input->>'evidence_binding_sha256',p_input->>'catalogue_sha256');
  return receipt;
end $$;
revoke all on function public.rg_mcp_visual_submission_store(text,jsonb) from public,anon,authenticated;
grant execute on function public.rg_mcp_visual_submission_store(text,jsonb) to service_role;
