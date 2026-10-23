-- Private, revision-bound advisory derivatives. This does not edit result manifests.
-- The worker verifies uploaded derivative bytes/checksums before internal save.
create table rg_mcp.visual_catalogues (
  survey_id uuid not null references public.rg_surveys(id),
  job_id uuid not null references public.rg_processing_jobs(id),
  result_revision integer not null check(result_revision>=1),
  catalogue jsonb not null check(jsonb_typeof(catalogue)='object'),
  catalogue_sha256 text not null check(catalogue_sha256=encode(sha256(convert_to(catalogue::text,'UTF8')),'hex')),
  created_at timestamptz not null default now(),
  primary key(survey_id,job_id,result_revision),
  check(catalogue->>'survey_id'=survey_id::text and catalogue->>'job_id'=job_id::text
    and (catalogue->>'result_revision')::integer=result_revision)
);
alter table rg_mcp.visual_catalogues enable row level security;
revoke all on rg_mcp.visual_catalogues from public,anon,authenticated;
grant select,insert on rg_mcp.visual_catalogues to service_role;

-- Separate receipts mean only that validated bytes were served, never that a
-- model inspected them. They are scoped to a grant and immutable catalogue.
create table rg_mcp.visual_deliveries (
  grant_id uuid not null references rg_mcp.grants(id),
  survey_id uuid not null, job_id uuid not null, result_revision integer not null,
  catalogue_sha256 text not null check(catalogue_sha256 ~ '^[0-9a-f]{64}$'),
  image_id text not null, created_at timestamptz not null default now(),
  primary key(grant_id,survey_id,job_id,result_revision,catalogue_sha256,image_id),
  foreign key(survey_id,job_id,result_revision)
    references rg_mcp.visual_catalogues(survey_id,job_id,result_revision)
);
alter table rg_mcp.visual_deliveries enable row level security;
revoke all on rg_mcp.visual_deliveries from public,anon,authenticated;
grant select,insert on rg_mcp.visual_deliveries to service_role;

-- Reserve the first validated encoding before authorizing any upload. Different
-- initial preparations cannot receive PUT URLs for the same immutable paths.
-- A reservation is not a stored/verified catalogue and never makes media ready.
create table rg_mcp.visual_preparations (
  survey_id uuid not null references public.rg_surveys(id),
  job_id uuid not null references public.rg_processing_jobs(id),
  result_revision integer not null check(result_revision>=1),
  catalogue_sha256 text not null check(catalogue_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key(survey_id,job_id,result_revision)
);
alter table rg_mcp.visual_preparations enable row level security;
revoke all on rg_mcp.visual_preparations from public,anon,authenticated;
grant select,insert on rg_mcp.visual_preparations to service_role;

create function rg_mcp.visual_source(p_survey uuid,p_job uuid,p_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.rg_surveys; r public.rg_result_revisions; j public.rg_processing_jobs;
begin
  select * into s from public.rg_surveys where id=p_survey for share;
  if s.id is null or s.archived_at is not null or s.active_result_revision is distinct from p_revision
    then raise exception 'Stale or archived visual evidence'; end if;
  select * into r from public.rg_result_revisions
    where survey_id=p_survey and job_id=p_job and revision=p_revision for share;
  select * into j from public.rg_processing_jobs where id=p_job and survey_id=p_survey for share;
  if r.id is null or j.id is null or j.result_manifest is null
    or r.manifest is distinct from j.result_manifest
    or r.manifest->>'schema_version' is distinct from 'riceguard.result.v2'
    or jsonb_typeof(r.manifest->'assets') is distinct from 'array'
    or jsonb_typeof(r.manifest->'artifacts') is distinct from 'object'
    or j.run_id is null or j.run_id !~ '^[A-Za-z0-9_-]{1,128}$'
    then raise exception 'Unavailable or stale visual evidence'; end if;
  return jsonb_build_object('manifest',r.manifest,'run_id',j.run_id);
end $$;

create function rg_mcp.validate_visual_catalogue(c jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare source jsonb; manifest jsonb; a jsonb; e jsonb; variant text; field text;
  photo_index integer:=0; photo_count integer; source_path text; expected_path text;
  uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if jsonb_typeof(c) is distinct from 'object'
    or not c ?& array['schema_version','policy_version','survey_id','job_id','result_revision','entries']
    or c-array['schema_version','policy_version','survey_id','job_id','result_revision','entries']<>'{}'::jsonb
    or c->>'schema_version' is distinct from 'riceguard.advisory.catalogue.v1'
    or c->>'policy_version' is distinct from 'visual-v1'
    or jsonb_typeof(c->'survey_id') is distinct from 'string' or c->>'survey_id' !~ uuid_pattern
    or jsonb_typeof(c->'job_id') is distinct from 'string' or c->>'job_id' !~ uuid_pattern
    or jsonb_typeof(c->'result_revision') is distinct from 'number'
    or c->>'result_revision' !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(c->'entries') is distinct from 'array'
    then raise exception 'Invalid visual catalogue'; end if;
  source:=rg_mcp.visual_source((c->>'survey_id')::uuid,(c->>'job_id')::uuid,(c->>'result_revision')::integer);
  manifest:=source->'manifest';
  select count(*) into photo_count from jsonb_array_elements(manifest->'assets') x where x->>'kind'='image';
  if photo_count not between 1 and 10 or jsonb_array_length(c->'entries')<>2*photo_count
    then raise exception 'Invalid visual catalogue photo count'; end if;
  for e in select value from jsonb_array_elements(c->'entries') loop
    if jsonb_typeof(e) is distinct from 'object'
      or not e ?& array['source_asset_id','image_index','variant','source_sha256','path','sha256','bytes','width','height','quality']
      or e-array['source_asset_id','image_index','variant','source_sha256','path','sha256','bytes','width','height','quality']<>'{}'::jsonb
      then raise exception 'Invalid visual catalogue entry'; end if;
    foreach field in array array['source_asset_id','variant','source_sha256','path','sha256'] loop
      if jsonb_typeof(e->field) is distinct from 'string' then raise exception 'Invalid visual catalogue string'; end if;
    end loop;
    if e->>'source_asset_id' !~ uuid_pattern or e->>'variant' not in ('original','combined')
      or e->>'source_sha256' !~ '^[0-9a-f]{64}$' or e->>'sha256' !~ '^[0-9a-f]{64}$'
      then raise exception 'Invalid visual catalogue identity or hash'; end if;
    foreach field in array array['image_index','bytes','width','height','quality'] loop
      if jsonb_typeof(e->field) is distinct from 'number' or e->>field !~ '^[0-9]{1,8}$'
        then raise exception 'Invalid visual catalogue integer'; end if;
    end loop;
    if (e->>'image_index')::integer not between 1 and 10 or (e->>'bytes')::integer not between 1 and 786432
      or (e->>'width')::integer not between 1 and 2048 or (e->>'height')::integer not between 1 and 2048
      or (e->>'quality')::integer not between 50 and 85 then raise exception 'Invalid visual catalogue limits'; end if;
  end loop;
  if (select count(distinct x->>'path') from jsonb_array_elements(c->'entries') x)<>2*photo_count
    then raise exception 'Duplicate visual catalogue path'; end if;
  for a in select value from jsonb_array_elements(manifest->'assets') where value->>'kind'='image' loop
    photo_index:=photo_index+1;
    if jsonb_typeof(a->'source_asset_id') is distinct from 'string' or a->>'source_asset_id' !~ uuid_pattern
      or (select count(*) from jsonb_array_elements(manifest->'assets') x where x->>'source_asset_id'=a->>'source_asset_id')<>1
      then raise exception 'Invalid visual evidence asset identity'; end if;
    foreach variant in array array['original','combined'] loop
      if (select count(*) from jsonb_array_elements(c->'entries') x
        where x->>'source_asset_id'=a->>'source_asset_id' and x->>'variant'=variant)<>1
        then raise exception 'Missing or duplicate visual catalogue variant'; end if;
      select value into e from jsonb_array_elements(c->'entries')
        where value->>'source_asset_id'=a->>'source_asset_id' and value->>'variant'=variant;
      source_path:=a->'review_paths'->>variant;
      expected_path:='website-inference/v2/jobs/'||(source->>'run_id')||'/outputs/advisory-media/visual-v1/'||(a->>'source_asset_id')||'/'||variant||'.jpg';
      if jsonb_typeof(a->'review_paths'->variant) is distinct from 'string'
        or jsonb_typeof(manifest->'artifacts'->source_path->'sha256') is distinct from 'string'
        or manifest->'artifacts'->source_path->>'sha256' !~ '^[0-9a-f]{64}$'
        or e->>'source_sha256' is distinct from manifest->'artifacts'->source_path->>'sha256'
        or e->>'path' is distinct from expected_path or (e->>'image_index')::integer<>photo_index
        then raise exception 'Visual catalogue source binding mismatch'; end if;
    end loop;
  end loop;
end $$;

create function rg_mcp.visual_catalogue_insert() returns trigger
language plpgsql security invoker set search_path='' as $$
begin perform rg_mcp.validate_visual_catalogue(new.catalogue); return new; end $$;
create trigger validate_visual_catalogue before insert on rg_mcp.visual_catalogues
for each row execute function rg_mcp.visual_catalogue_insert();
create function rg_mcp.reject_visual_mutation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Private visual rows are immutable'; end $$;
create trigger immutable_visual_catalogue before update or delete on rg_mcp.visual_catalogues
for each row execute function rg_mcp.reject_visual_mutation();
create trigger immutable_visual_delivery before update or delete on rg_mcp.visual_deliveries
for each row execute function rg_mcp.reject_visual_mutation();
create trigger immutable_visual_preparation before update or delete on rg_mcp.visual_preparations
for each row execute function rg_mcp.reject_visual_mutation();

create function public.rg_mcp_visual_store(p_operation text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g rg_mcp.grants; saved rg_mcp.visual_catalogues; c jsonb; digest text;
  survey uuid; job uuid; revision integer; image_id text; image_ids jsonb;
  inserted integer; was_duplicate boolean;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid visual input'; end if;
  if p_operation in ('validate_catalogue','save_catalogue') then
    c:=p_input->'catalogue'; perform rg_mcp.validate_visual_catalogue(c);
    survey:=(c->>'survey_id')::uuid; job:=(c->>'job_id')::uuid; revision:=(c->>'result_revision')::integer;
    digest:=encode(sha256(convert_to(c::text,'UTF8')),'hex');
    select * into saved from rg_mcp.visual_catalogues where survey_id=survey and job_id=job and result_revision=revision;
    if saved.catalogue is not null and (saved.catalogue is distinct from c or saved.catalogue_sha256 is distinct from digest)
      then raise exception 'Immutable visual catalogue conflict'; end if;
    insert into rg_mcp.visual_preparations(survey_id,job_id,result_revision,catalogue_sha256)
      values(survey,job,revision,digest) on conflict do nothing;
    if not exists(select 1 from rg_mcp.visual_preparations p
      where p.survey_id=survey and p.job_id=job and p.result_revision=revision and p.catalogue_sha256=digest)
      then raise exception 'Immutable visual preparation conflict'; end if;
    if p_operation='validate_catalogue' then return jsonb_build_object('valid',true); end if;
    insert into rg_mcp.visual_catalogues(survey_id,job_id,result_revision,catalogue,catalogue_sha256)
      values(survey,job,revision,c,digest) on conflict do nothing;
    get diagnostics inserted=row_count; was_duplicate:=inserted=0;
    select * into saved from rg_mcp.visual_catalogues where survey_id=survey and job_id=job and result_revision=revision;
    if saved.catalogue is distinct from c or saved.catalogue_sha256 is distinct from digest
      then raise exception 'Immutable visual catalogue conflict'; end if;
    return jsonb_build_object('stored',true,'duplicate',was_duplicate,'catalogue_sha256',digest);
  elsif p_operation in ('read_catalogue','record_delivery','assert_delivery') then
    g:=rg_mcp.require_grant((p_input->>'grant_id')::uuid,'evidence:read');
    if not g.allow_images then raise exception 'Image consent required'; end if;
    if jsonb_typeof(p_input->'survey_id') is distinct from 'string'
      or jsonb_typeof(p_input->'job_id') is distinct from 'string'
      or jsonb_typeof(p_input->'result_revision') is distinct from 'number'
      or p_input->>'result_revision' !~ '^[1-9][0-9]{0,8}$' then raise exception 'Invalid visual key'; end if;
    survey:=(p_input->>'survey_id')::uuid; job:=(p_input->>'job_id')::uuid; revision:=(p_input->>'result_revision')::integer;
    perform rg_mcp.evidence_snapshot(g.id,survey,job,revision);
    perform rg_mcp.visual_source(survey,job,revision);
    select * into saved from rg_mcp.visual_catalogues where survey_id=survey and job_id=job and result_revision=revision;
    if saved.catalogue is not null then perform rg_mcp.validate_visual_catalogue(saved.catalogue); end if;
    if p_operation='read_catalogue' then
      return jsonb_build_object('catalogue',saved.catalogue,'catalogue_sha256',saved.catalogue_sha256);
    end if;
    if saved.catalogue is null or jsonb_typeof(p_input->'catalogue_sha256') is distinct from 'string'
      or p_input->>'catalogue_sha256' is distinct from saved.catalogue_sha256
      then raise exception 'Unavailable or stale visual catalogue'; end if;
    if p_operation='record_delivery' then
      image_ids:=p_input->'image_ids';
      if jsonb_typeof(image_ids) is distinct from 'array' then raise exception 'Invalid visual delivery IDs'; end if;
      if jsonb_array_length(image_ids) not between 1 and 2
        or exists(select 1 from jsonb_array_elements(image_ids) x where jsonb_typeof(x)<>'string')
        or (select count(distinct x) from jsonb_array_elements(image_ids) x)<>jsonb_array_length(image_ids)
        then raise exception 'Invalid visual delivery IDs'; end if;
      for image_id in select value from jsonb_array_elements_text(image_ids) loop
        if not exists(select 1 from jsonb_array_elements(saved.catalogue->'entries') e
          where (e->>'source_asset_id')||':'||(e->>'variant')=image_id)
          then raise exception 'Unknown visual delivery image'; end if;
        insert into rg_mcp.visual_deliveries(grant_id,survey_id,job_id,result_revision,catalogue_sha256,image_id)
          values(g.id,survey,job,revision,saved.catalogue_sha256,image_id) on conflict do nothing;
      end loop;
      return jsonb_build_object('recorded',true);
    end if;
    if exists(select 1 from jsonb_array_elements(saved.catalogue->'entries') e where not exists(
      select 1 from rg_mcp.visual_deliveries d where d.grant_id=g.id and d.survey_id=survey and d.job_id=job
        and d.result_revision=revision and d.catalogue_sha256=saved.catalogue_sha256
        and d.image_id=(e->>'source_asset_id')||':'||(e->>'variant')))
      then raise exception 'Incomplete visual delivery'; end if;
    return jsonb_build_object('complete',true);
  end if;
  raise exception 'Unsupported visual operation';
end $$;

revoke all on function rg_mcp.visual_source(uuid,uuid,integer),rg_mcp.validate_visual_catalogue(jsonb),
  rg_mcp.visual_catalogue_insert(),rg_mcp.reject_visual_mutation() from public,anon,authenticated;
grant execute on function rg_mcp.visual_source(uuid,uuid,integer),rg_mcp.validate_visual_catalogue(jsonb),
  rg_mcp.visual_catalogue_insert(),rg_mcp.reject_visual_mutation() to service_role;
revoke all on function public.rg_mcp_visual_store(text,jsonb) from public,anon,authenticated;
grant execute on function public.rg_mcp_visual_store(text,jsonb) to service_role;
