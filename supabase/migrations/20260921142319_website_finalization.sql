-- RiceGuardAI operational finalization.
-- Additive migration: historical rows and original class names remain auditable.

create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Expand the survey lifecycle and allow analysis without a location. A missing
-- location blocks geographic alerts, not inference.
alter table public.rg_surveys drop constraint if exists rg_surveys_status_check;
alter table public.rg_surveys drop constraint if exists rg_surveys_severity_check;
alter table public.rg_surveys drop constraint if exists rg_surveys_photos_check;
alter table public.rg_surveys drop constraint if exists rg_surveys_lat_check;
alter table public.rg_surveys drop constraint if exists rg_surveys_lng_check;
update public.rg_surveys set status='Running' where status='Processing';
update public.rg_surveys set severity='moderate' where severity='medium';
alter table public.rg_surveys alter column lat drop not null;
alter table public.rg_surveys alter column lng drop not null;
alter table public.rg_surveys
  add column if not exists location_status text not null default 'missing',
  add column if not exists progress integer not null default 0,
  add column if not exists stage_updated_at timestamptz not null default now(),
  add column if not exists active_result_revision integer,
  add column if not exists approved_result_revision integer,
  add column if not exists manifest_hash text,
  add column if not exists expected_assets integer not null default 0;
alter table public.rg_surveys
  add constraint rg_surveys_status_check check(status in (
    'Awaiting upload','Validating','Queued','Submitting','Waiting for GPU',
    'Running','Validating results','Needs review','Reviewed','Failed','Cancelled'
  )),
  add constraint rg_surveys_severity_check check(severity in (
    'low','moderate','high','not_calibrated','unknown'
  )),
  add constraint rg_surveys_location_status_check check(location_status in (
    'verified','extracted','needs_review','missing'
  )),
  add constraint rg_surveys_progress_check check(progress between 0 and 100),
  add constraint rg_surveys_photos_check check(photos between 0 and 250),
  add constraint rg_surveys_coordinate_pair_check check((lat is null) = (lng is null)),
  add constraint rg_surveys_lat_check check(lat is null or lat between -90 and 90),
  add constraint rg_surveys_lng_check check(lng is null or lng between -180 and 180);

-- Originals live in a private Drive application folder. These rows retain the
-- verified metadata and resumable-upload state, not the original bytes.
alter table public.rg_assets alter column checksum drop not null;
alter table public.rg_assets alter column width drop not null;
alter table public.rg_assets alter column height drop not null;
alter table public.rg_assets
  add column if not exists mime text,
  add column if not exists bytes bigint,
  add column if not exists md5_checksum text,
  add column if not exists duration_seconds numeric,
  add column if not exists drive_file_id text,
  add column if not exists drive_parent_id text,
  add column if not exists upload_session_id uuid,
  add column if not exists preview_url text,
  add column if not exists capture_time timestamptz,
  add column if not exists exif_lat double precision,
  add column if not exists exif_lng double precision,
  add column if not exists verified_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
alter table public.rg_assets drop constraint if exists rg_assets_state_check;
alter table public.rg_assets
  add constraint rg_assets_state_check check(state in (
    'Awaiting upload','Uploading','Uploaded','Validating','Verified','Rejected','Processing','Complete','Failed'
  )),
  add constraint rg_assets_bytes_check check(bytes is null or bytes between 1 and 5368709120),
  add constraint rg_assets_dimensions_check check(
    (width is null and height is null) or
    (width between 1 and 30000 and height between 1 and 30000)
  );
create unique index if not exists rg_assets_drive_file on public.rg_assets(drive_file_id) where drive_file_id is not null;

create table if not exists public.rg_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null unique references public.rg_assets(id) on delete cascade,
  provider text not null default 'google_drive' check(provider='google_drive'),
  provider_session_url text not null,
  expires_at timestamptz not null,
  offset_bytes bigint not null default 0,
  state text not null default 'active' check(state in ('active','complete','expired','cancelled')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rg_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.rg_surveys(id),
  run_id text not null unique,
  manifest jsonb not null,
  manifest_hash text not null unique check(manifest_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'Queued' check(status in (
    'Queued','Submitting','Waiting for GPU','Running','Validating results',
    'Needs review','Reviewed','Failed','Cancelled'
  )),
  progress integer not null default 0 check(progress between 0 and 100),
  lease_owner text,
  lease_expires_at timestamptz,
  submit_attempts integer not null default 0,
  kaggle_kernel_ref text,
  kaggle_version integer,
  worker_token_hash text not null,
  worker_token_expires_at timestamptz not null,
  callback_sequence bigint not null default 0,
  result_manifest jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists rg_jobs_queue on public.rg_processing_jobs(status,created_at);
create index if not exists rg_jobs_survey on public.rg_processing_jobs(survey_id,created_at desc);

create table if not exists public.rg_job_callbacks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.rg_processing_jobs(id) on delete cascade,
  sequence bigint not null,
  event text not null,
  payload jsonb not null default '{}',
  received_at timestamptz not null default now(),
  unique(job_id,sequence)
);

create table if not exists public.rg_model_registry (
  id uuid primary key default gen_random_uuid(),
  disease text not null check(disease in ('BLB','Brown Spot')),
  version text not null,
  architecture text not null,
  encoder text not null,
  input_size integer not null default 1024 check(input_size between 256 and 2048),
  overlap numeric not null default 0.25 check(overlap >= 0 and overlap < 0.75),
  threshold numeric not null check(threshold between 0 and 1),
  minimum_component_pixels integer not null default 0 check(minimum_component_pixels >= 0),
  preprocessing jsonb not null,
  artifact_drive_file_id text not null,
  artifact_sha256 text not null check(artifact_sha256 ~ '^[a-f0-9]{64}$'),
  active boolean not null default false,
  validation_summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(disease,version)
);
create unique index if not exists rg_one_active_model_per_disease on public.rg_model_registry(disease) where active;

create table if not exists public.rg_result_revisions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.rg_surveys(id),
  job_id uuid not null references public.rg_processing_jobs(id),
  revision integer not null,
  manifest jsonb not null,
  drive_folder_id text not null,
  blb_model_version text not null,
  brown_spot_model_version text not null,
  blb_coverage numeric,
  brown_spot_affected_leaf_coverage numeric,
  visible_leaf_denominator_reviewed boolean not null default false,
  severity_status text not null default 'not_calibrated' check(severity_status in ('not_calibrated','calibrated')),
  severity_label text not null default 'not_calibrated' check(severity_label in ('low','moderate','high','not_calibrated')),
  calibration_version text,
  warnings jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique(survey_id,revision)
);

create table if not exists public.rg_severity_calibrations (
  id uuid primary key default gen_random_uuid(),
  disease text not null check(disease in ('BLB','Brown Spot')),
  version text not null,
  low_moderate_threshold numeric not null,
  moderate_high_threshold numeric not null,
  evidence jsonb not null,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null,
  active boolean not null default false,
  check(low_moderate_threshold < moderate_high_threshold),
  unique(disease,version)
);
create unique index if not exists rg_one_active_calibration on public.rg_severity_calibrations(disease) where active;

-- Preserve historical labels in old rows. New drafts use only the current two
-- disease outputs; Rice Blast is not silently rewritten as Brown Spot.
alter table public.rg_bulletins drop constraint if exists rg_bulletins_disease_check;
alter table public.rg_bulletins drop constraint if exists rg_bulletins_severity_check;
alter table public.rg_bulletins alter column lat drop not null;
alter table public.rg_bulletins alter column lng drop not null;
alter table public.rg_bulletins
  add column if not exists legacy_disease_name text,
  add column if not exists result_revision integer,
  add column if not exists advisory_revision integer not null default 1,
  add column if not exists recipient_preview_hash text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists correction_note text,
  add column if not exists limitations text not null default '',
  add column if not exists advisory_source_ids uuid[] not null default '{}';
update public.rg_bulletins set legacy_disease_name=disease where disease not in ('BLB','Brown Spot') and legacy_disease_name is null;
update public.rg_bulletins set severity='moderate' where severity='medium';
alter table public.rg_bulletins
  add constraint rg_bulletins_disease_check check(disease in ('BLB','Brown Spot','Rice Blast')),
  add constraint rg_bulletins_current_public_disease_check check(status <> 'published' or disease in ('BLB','Brown Spot')) not valid,
  add constraint rg_bulletins_severity_check check(severity in ('low','moderate','high','not_calibrated','unknown'));

create table if not exists public.rg_advisory_sources (
  id uuid primary key default gen_random_uuid(),
  disease text not null check(disease in ('BLB','Brown Spot')),
  title text not null,
  version text not null,
  guidance jsonb not null,
  source_reference text not null,
  reviewed_by uuid not null references auth.users(id),
  approved_at timestamptz not null,
  active boolean not null default true,
  unique(disease,version)
);

-- Deliberately denormalized, GPS-sanitized public projection. Exact locations,
-- EXIF, result manifests, subscriber data and original Drive IDs never enter it.
create table if not exists public.rg_public_posts (
  id uuid primary key references public.rg_bulletins(id) on delete cascade,
  slug text not null unique,
  title text not null,
  approximate_location text not null,
  disease text not null check(disease in ('BLB','Brown Spot')),
  assessment_label text not null check(assessment_label in ('low','moderate','high','not_calibrated','unknown')),
  summary text not null,
  recommended_actions text not null,
  limitations text not null,
  cover_url text,
  media jsonb not null default '[]',
  reviewer_name text,
  approximate_lat numeric,
  approximate_lng numeric,
  revision integer not null,
  correction_note text,
  published_at timestamptz not null,
  updated_at timestamptz not null
);
create index if not exists rg_public_posts_feed on public.rg_public_posts(published_at desc,id);
create index if not exists rg_public_posts_filter on public.rg_public_posts(disease,published_at desc);

-- Delivery receipts are recipient-level. Gateway acceptance must never be
-- treated as delivery.
alter table public.rg_recipients
  add column if not exists accepted_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists client_message_id text;
create unique index if not exists rg_recipient_client_message on public.rg_recipients(client_message_id) where client_message_id is not null;

-- Nullable survey coordinates need a nullable-safe coverage trigger.
create or replace function private.rg_validate_geo() returns trigger language plpgsql set search_path='' as $$
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
end $$;

-- Prevent self-service profile role escalation using the authenticated user
-- identity, without relying on the deprecated auth.role() helper.
create or replace function private.rg_profile_protection() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is not null then
    if tg_op='INSERT' and (new.role::text <> 'farmer' or not new.is_active) then raise exception 'Protected profile fields'; end if;
    if tg_op='UPDATE' and (new.role is distinct from old.role or new.is_active is distinct from old.is_active or new.phone is distinct from old.phone or new.id is distinct from old.id) then raise exception 'Protected profile fields'; end if;
  end if;
  return new;
end $$;

-- Claim exactly one dispatchable job with a short lease. Reconciliation uses
-- the same run_id before any retry, preventing duplicate notebook versions.
create or replace function public.rg_claim_dispatch_v2(p_owner text,p_lease_seconds integer default 90)
returns public.rg_processing_jobs language plpgsql security definer set search_path='' as $$
declare j public.rg_processing_jobs;
begin
  select * into j from public.rg_processing_jobs
   where status in ('Queued','Waiting for GPU')
     and (lease_expires_at is null or lease_expires_at < now())
   order by created_at
   for update skip locked limit 1;
  if not found then return null; end if;
  update public.rg_processing_jobs set status='Submitting',lease_owner=p_owner,
    lease_expires_at=now()+make_interval(secs=>greatest(30,p_lease_seconds)),
    submit_attempts=submit_attempts+1,updated_at=now() where id=j.id returning * into j;
  return j;
end $$;
revoke all on function public.rg_claim_dispatch_v2(text,integer) from public,anon,authenticated;
grant execute on function public.rg_claim_dispatch_v2(text,integer) to service_role;

-- One approval publishes one immutable revision and creates at most one SMS
-- campaign. Missing location produces zero geographic recipients.
create or replace function public.rg_publish_v2(p_id uuid,p_actor uuid,p_expected_revision integer,p_recipient_preview_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.rg_bulletins; s public.rg_surveys; campaign uuid; public_lat numeric; public_lng numeric;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active) then raise exception 'Active admin role required'; end if;
  select * into b from public.rg_bulletins where id=p_id for update;
  if not found then raise exception 'Advisory not found'; end if;
  select * into s from public.rg_surveys where id=b.survey_id for update;
  if b.disease not in ('BLB','Brown Spot') then raise exception 'Historical disease labels cannot be newly published'; end if;
  if s.status<>'Reviewed' or s.approved_result_revision is null or b.result_revision<>s.approved_result_revision then raise exception 'Approve the exact result revision first'; end if;
  if b.advisory_revision<>p_expected_revision then raise exception 'Stale advisory revision'; end if;
  if b.recipient_preview_hash is distinct from p_recipient_preview_hash then raise exception 'Recipient preview changed; review again'; end if;
  if not b.media_approved then raise exception 'Approve public media first'; end if;
  if b.status='published' then select id into campaign from public.rg_campaigns where bulletin_id=b.id and revision=b.revision; return campaign; end if;
  public_lat := case when b.public_location_approved and s.lat is not null then round(s.lat::numeric,2) end;
  public_lng := case when b.public_location_approved and s.lng is not null then round(s.lng::numeric,2) end;
  update public.rg_bulletins set status='published',reviewer_id=p_actor,
    reviewer=(select full_name from public.profiles where id=p_actor),published_at=now(),updated_at=now()
    where id=b.id returning * into b;
  insert into public.rg_public_posts(id,slug,title,approximate_location,disease,assessment_label,summary,recommended_actions,limitations,cover_url,media,reviewer_name,approximate_lat,approximate_lng,revision,correction_note,published_at,updated_at)
  values(b.id,b.slug,b.title,b.location,b.disease,b.severity,b.body,b.action,b.limitations,b.image,
    jsonb_build_array(jsonb_build_object('url',b.image,'alt','Approved public survey preview','type','image')),
    b.reviewer,public_lat,public_lng,b.advisory_revision,b.correction_note,b.published_at,b.updated_at)
  on conflict(id) do update set title=excluded.title,approximate_location=excluded.approximate_location,
    assessment_label=excluded.assessment_label,summary=excluded.summary,recommended_actions=excluded.recommended_actions,
    limitations=excluded.limitations,cover_url=excluded.cover_url,media=excluded.media,reviewer_name=excluded.reviewer_name,
    approximate_lat=excluded.approximate_lat,approximate_lng=excluded.approximate_lng,revision=excluded.revision,
    correction_note=excluded.correction_note,updated_at=excluded.updated_at;
  insert into public.rg_campaigns(bulletin_id,revision) values(b.id,b.advisory_revision)
    on conflict(bulletin_id,revision) do update set status=public.rg_campaigns.status returning id into campaign;
  if s.lat is not null and s.lng is not null and b.public_location_approved then
    insert into public.rg_recipients(campaign_id,contact_id,phone,client_message_id)
      select distinct campaign,c.id,c.phone,encode(extensions.digest((campaign::text||':'||c.id::text)::bytea,'sha256'),'hex')
      from public.rg_contacts c join public.rg_farms f on f.contact_id=c.id
      where c.consent and c.verified and extensions.st_dwithin(
        f.geometry,extensions.st_setsrid(extensions.st_makepoint(s.lng,s.lat),4326)::extensions.geography,3000)
      on conflict(campaign_id,phone) do nothing;
  end if;
  update public.rg_campaigns set recipients=(select count(*) from public.rg_recipients where campaign_id=campaign) where id=campaign;
  insert into public.rg_outbox(kind,entity_id) values('sms-campaign',campaign) on conflict do nothing;
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('advisory-published',b.id::text,p_actor,
    jsonb_build_object('result_revision',b.result_revision,'advisory_revision',b.advisory_revision,'campaign_id',campaign));
  return campaign;
end $$;
revoke all on function public.rg_publish_v2(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.rg_publish_v2(uuid,uuid,integer,text) to service_role;

create or replace function public.rg_recipient_preview_v2(p_bulletin uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.rg_bulletins; s public.rg_surveys; recipient_ids text[]; preview_hash text;
begin
  select * into b from public.rg_bulletins where id=p_bulletin;
  if not found then raise exception 'Advisory not found'; end if;
  select * into s from public.rg_surveys where id=b.survey_id;
  if s.lat is null or s.lng is null or not b.public_location_approved then
    recipient_ids := '{}';
  else
    select coalesce(array_agg(distinct c.id::text order by c.id::text),'{}') into recipient_ids
      from public.rg_contacts c join public.rg_farms f on f.contact_id=c.id
      where c.consent and c.verified and extensions.st_dwithin(
        f.geometry,extensions.st_setsrid(extensions.st_makepoint(s.lng,s.lat),4326)::extensions.geography,3000);
  end if;
  preview_hash := encode(extensions.digest(array_to_string(recipient_ids,',')::bytea,'sha256'),'hex');
  update public.rg_bulletins set recipient_preview_hash=preview_hash,updated_at=now() where id=b.id;
  return jsonb_build_object('count',cardinality(recipient_ids),'hash',preview_hash,'location_ready',s.lat is not null and s.lng is not null and b.public_location_approved);
end $$;
revoke all on function public.rg_recipient_preview_v2(uuid) from public,anon,authenticated;
grant execute on function public.rg_recipient_preview_v2(uuid) to service_role;

-- The legacy view is no longer public. Public clients read only the sanitized
-- projection table guarded below.
revoke all on public.rg_public_bulletins from anon,authenticated;

do $$ declare t text; begin
  foreach t in array array[
    'rg_upload_sessions','rg_processing_jobs','rg_job_callbacks','rg_model_registry',
    'rg_result_revisions','rg_severity_calibrations','rg_advisory_sources'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy staff_read on public.%I for select to authenticated using ((select public.is_admin()))',t);
  end loop;
end $$;

alter table public.rg_public_posts enable row level security;
revoke all on public.rg_public_posts from anon,authenticated;
grant select on public.rg_public_posts to anon,authenticated;
create policy rg_public_posts_read on public.rg_public_posts for select to anon,authenticated using(true);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('rg-public-previews','rg-public-previews',true,52428800,array['image/webp','image/jpeg','image/png','video/mp4'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Store riceguard_project_url and riceguard_cron_secret in Supabase Vault.
-- Missing Vault configuration fails closed: the job returns without an HTTP call.
create or replace function private.rg_invoke_edge(p_function text) returns bigint
language plpgsql security definer set search_path='' as $$
declare project_url text; cron_secret text; request_id bigint;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name='riceguard_project_url' limit 1;
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name='riceguard_cron_secret' limit 1;
  if project_url is null or cron_secret is null then return null; end if;
  select net.http_post(
    url := rtrim(project_url,'/') || '/functions/v1/' || p_function,
    headers := jsonb_build_object('Authorization','Bearer '||cron_secret,'Content-Type','application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into request_id;
  return request_id;
end $$;
revoke all on function private.rg_invoke_edge(text) from public,anon,authenticated;

do $$ declare job_id bigint; begin
  select jobid into job_id from cron.job where jobname='riceguard-dispatch';
  if job_id is not null then perform cron.unschedule(job_id); end if;
  perform cron.schedule('riceguard-dispatch','*/5 * * * *',$job$select private.rg_invoke_edge('job-dispatcher');$job$);
  select jobid into job_id from cron.job where jobname='riceguard-reconcile';
  if job_id is not null then perform cron.unschedule(job_id); end if;
  perform cron.schedule('riceguard-reconcile','*/10 * * * *',$job$select private.rg_invoke_edge('job-reconciler');$job$);
  select jobid into job_id from cron.job where jobname='riceguard-sms';
  if job_id is not null then perform cron.unschedule(job_id); end if;
  perform cron.schedule('riceguard-sms','*/5 * * * *',$job$select private.rg_invoke_edge('send-sms');$job$);
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('rg-review-previews','rg-review-previews',false,104857600,array['image/webp','image/png','video/mp4'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
