-- Additive operations foundation. No live migration is applied by this file.
-- Legacy training, Tungro history, advisories and contacts are retained.
create extension if not exists postgis with schema extensions;
create schema if not exists private;

create table public.rg_location_releases (
  version text primary key, source_url text not null, checksum text not null,
  imported_at timestamptz not null default now(), active boolean not null default false
);
create unique index rg_one_active_release on public.rg_location_releases(active) where active;
create table public.rg_locations (
  code text primary key, name text not null, level text not null check(level in ('province','municipality','barangay')),
  parent_code text references public.rg_locations(code), release text not null references public.rg_location_releases(version),
  region_code text not null default '02' check(region_code = '02')
);
create index rg_locations_parent on public.rg_locations(parent_code);
create table public.rg_coverage (
  province_code text primary key references public.rg_locations(code),
  geometry extensions.geometry(MultiPolygon,4326) not null,
  source_url text not null, checksum text not null,
  check(extensions.st_isvalid(geometry))
);
create index rg_coverage_geometry on public.rg_coverage using gist(geometry);
create table public.rg_contacts (
  id uuid primary key default gen_random_uuid(), account_id uuid unique references auth.users(id),
  name text not null check(length(name) between 1 and 120), phone text not null unique check(phone ~ '^\+639[0-9]{9}$'),
  location text not null default '', barangay_code text references public.rg_locations(code),
  consent boolean not null default false, verified boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.rg_consent_events (
  id uuid primary key default gen_random_uuid(), contact_id uuid not null references public.rg_contacts(id),
  consent boolean not null, source text not null, actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index rg_consent_contact on public.rg_consent_events(contact_id,created_at desc);
create table public.rg_farms (
  id uuid primary key default gen_random_uuid(), contact_id uuid not null references public.rg_contacts(id),
  name text not null, barangay_code text not null references public.rg_locations(code),
  geometry extensions.geography(Geometry,4326) not null,
  check(extensions.geometrytype(geometry::extensions.geometry) in ('POINT','POLYGON','MULTIPOLYGON')),
  check(extensions.st_isvalid(geometry::extensions.geometry))
);
create index rg_farms_contact on public.rg_farms(contact_id);
create index rg_farms_geo on public.rg_farms using gist(geometry);
create table public.rg_surveys (
  id uuid primary key default gen_random_uuid(), name text not null, location text not null,
  captured_at timestamptz not null, camera text not null,
  status text not null default 'Awaiting upload' check(status in ('Awaiting upload','Validating','Queued','Processing','Needs review','Reviewed','Failed')),
  photos integer not null default 0 check(photos between 0 and 100),
  severity text not null default 'unknown' check(severity in ('low','medium','high','unknown')),
  lat double precision not null check(lat between -90 and 90), lng double precision not null check(lng between -180 and 180),
  note text, created_by uuid references auth.users(id), created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id), reviewed_at timestamptz
);
create index rg_surveys_state on public.rg_surveys(status,created_at desc);
create table public.rg_assets (
  id uuid primary key default gen_random_uuid(), survey_id uuid not null references public.rg_surveys(id),
  checksum text not null check(checksum ~ '^[a-f0-9]{64}$'), filename text not null,
  width integer not null check(width between 512 and 20000), height integer not null check(height between 512 and 20000),
  orientation integer not null default 1, original_key text, job_id text unique,
  state text not null default 'Awaiting upload', result jsonb, error text,
  created_at timestamptz not null default now(), unique(survey_id, checksum)
);
create index rg_assets_survey on public.rg_assets(survey_id);
create table public.rg_bulletins (
  id uuid primary key default gen_random_uuid(), survey_id uuid not null references public.rg_surveys(id),
  slug text not null unique check(slug ~ '^[a-z0-9-]+$'), title text not null, location text not null,
  disease text not null check(disease in ('BLB','Rice Blast')),
  severity text not null default 'unknown' check(severity in ('low','medium','high','unknown')),
  body text not null, action text not null, date date not null default current_date,
  status text not null default 'draft' check(status in ('draft','published')),
  image text not null, reviewer text, reviewer_id uuid references auth.users(id),
  sample boolean not null default false check(sample = false),
  lat double precision not null, lng double precision not null,
  public_location_approved boolean not null default false, media_approved boolean not null default false,
  revision integer not null default 1, published_at timestamptz,
  source_ids text[] not null default '{}', created_at timestamptz not null default now()
);
create index rg_bulletins_survey on public.rg_bulletins(survey_id);
create index rg_bulletins_published on public.rg_bulletins(date desc) where status='published';
create table public.rg_campaigns (
  id uuid primary key default gen_random_uuid(), bulletin_id uuid not null references public.rg_bulletins(id),
  revision integer not null, status text not null default 'queued', recipients integer not null default 0,
  sample boolean not null default false check(sample=false), created_at timestamptz not null default now(),
  unique(bulletin_id,revision)
);
create table public.rg_recipients (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.rg_campaigns(id),
  contact_id uuid not null references public.rg_contacts(id), phone text not null,
  status text not null default 'queued' check(status in ('queued','accepted','sent','delivered','failed','unknown','suppressed')),
  message_id text unique, error text, attempts integer not null default 0,
  not_before timestamptz not null default now(), created_at timestamptz not null default now(),
  unique(campaign_id,phone)
);
create index rg_recipients_contact on public.rg_recipients(contact_id,created_at desc);
create index rg_recipients_pending on public.rg_recipients(not_before) where status='queued';
create table public.rg_events (
  id uuid primary key default gen_random_uuid(), external_id text unique,
  kind text not null, entity_id text, actor_id uuid references auth.users(id),
  detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.rg_outbox (
  id uuid primary key default gen_random_uuid(), kind text not null, entity_id uuid not null,
  state text not null default 'pending', attempts integer not null default 0,
  available_at timestamptz not null default now(), last_error text,
  unique(kind,entity_id)
);
create index rg_outbox_pending on public.rg_outbox(available_at) where state='pending';

-- Reject unsupported geography instead of treating a rectangular map viewport as Region II.
create function private.rg_validate_geo() returns trigger language plpgsql set search_path='' as $$
declare point extensions.geometry;
begin
  if tg_table_name='rg_surveys' then point := extensions.st_setsrid(extensions.st_makepoint(new.lng,new.lat),4326);
  else point := new.geometry::extensions.geometry; end if;
  if not exists(select 1 from public.rg_coverage c where extensions.st_covers(c.geometry, point)) then
    raise exception 'Location outside loaded Region II coverage or verified boundaries not loaded';
  end if;
  return new;
end $$;
create trigger rg_survey_geo before insert or update of lat,lng on public.rg_surveys for each row execute function private.rg_validate_geo();
create trigger rg_farm_geo before insert or update of geometry on public.rg_farms for each row execute function private.rg_validate_geo();

-- Existing profile self-edit policies must never allow role escalation.
create function private.rg_profile_protection() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (select auth.role())='authenticated' then
    if tg_op='INSERT' and (new.role::text <> 'farmer' or not new.is_active) then raise exception 'Protected profile fields'; end if;
    if tg_op='UPDATE' and (new.role is distinct from old.role or new.is_active is distinct from old.is_active or new.phone is distinct from old.phone or new.id is distinct from old.id) then raise exception 'Protected profile fields'; end if;
  end if;
  return new;
end $$;
create trigger rg_protect_profile before insert or update on public.profiles for each row execute function private.rg_profile_protection();

-- Authenticated staff read private operational records; writes go through guarded server actions.
do $$ declare t text; begin
  foreach t in array array['rg_location_releases','rg_locations','rg_coverage','rg_contacts','rg_consent_events','rg_farms','rg_surveys','rg_assets','rg_bulletins','rg_campaigns','rg_recipients','rg_events','rg_outbox'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy staff_read on public.%I for select to authenticated using ((select public.is_admin()))',t);
  end loop;
end $$;
grant select on public.rg_locations,public.rg_location_releases to anon;
create policy public_locations on public.rg_locations for select to anon,authenticated using (true);
create policy public_releases on public.rg_location_releases for select to anon,authenticated using (true);
create policy own_contact on public.rg_contacts for select to authenticated using(account_id=(select auth.uid()));
create policy own_farms on public.rg_farms for select to authenticated using(contact_id in(select id from public.rg_contacts where account_id=(select auth.uid())));

-- Intentionally security-definer projection: underlying private rows are NOT granted to anon.
-- Only approved public columns are selected. EXIF, contacts and precise survey coordinates are absent.
create view public.rg_public_bulletins with (security_barrier=true) as
select id,slug,title,location,disease,severity,body,action,date,status,image,reviewer,sample,lat,lng,revision,published_at,source_ids
from public.rg_bulletins where status='published' and public_location_approved and media_approved;
grant select on public.rg_public_bulletins to anon,authenticated;

create function public.rg_publish(p_id uuid,p_actor uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.rg_bulletins; s public.rg_surveys; campaign uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin' and is_active) then raise exception 'Staff role required'; end if;
  select * into b from public.rg_bulletins where id=p_id for update;
  if not found then raise exception 'Advisory not found'; end if;
  select * into s from public.rg_surveys where id=b.survey_id;
  if s.status<>'Reviewed' or s.reviewed_at is null or not b.public_location_approved or not b.media_approved then raise exception 'Complete evidence, location and media review first'; end if;
  if b.status='published' then select id into campaign from public.rg_campaigns where bulletin_id=b.id and revision=b.revision; return campaign; end if;
  update public.rg_bulletins set status='published',reviewer_id=p_actor,reviewer=(select full_name from public.profiles where id=p_actor),published_at=now() where id=b.id;
  insert into public.rg_campaigns(bulletin_id,revision) values(b.id,b.revision) returning id into campaign;
  insert into public.rg_recipients(campaign_id,contact_id,phone)
    select distinct campaign,c.id,c.phone from public.rg_contacts c join public.rg_farms f on f.contact_id=c.id
    where c.consent and c.verified and extensions.st_dwithin(f.geometry,extensions.st_setsrid(extensions.st_makepoint(s.lng,s.lat),4326)::extensions.geography,3000);
  update public.rg_campaigns set recipients=(select count(*) from public.rg_recipients where campaign_id=campaign) where id=campaign;
  insert into public.rg_outbox(kind,entity_id) values('sms-campaign',campaign) on conflict do nothing;
  insert into public.rg_events(kind,entity_id,actor_id,detail) values('advisory-published',b.id::text,p_actor,jsonb_build_object('revision',b.revision,'campaign_id',campaign));
  return campaign;
end $$;
revoke all on function public.rg_publish(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rg_publish(uuid,uuid) to service_role;

create function public.rg_update_contact(p_user uuid,p_name text,p_barangay text,p_consent boolean,p_phone text) returns uuid language plpgsql security definer set search_path='' as $$
declare contact uuid; place text;
begin
  -- Caller is server-only and supplies phone from verified Auth user, never request body.
  select string_agg(x.name,', ' order by case x.level when 'barangay' then 1 when 'municipality' then 2 else 3 end) into place
    from public.rg_locations x where x.code=p_barangay or x.code=(select parent_code from public.rg_locations where code=p_barangay) or x.code=(select parent_code from public.rg_locations where code=(select parent_code from public.rg_locations where code=p_barangay));
  if not exists(select 1 from public.rg_locations l join public.rg_location_releases r on r.version=l.release where l.code=p_barangay and l.level='barangay' and r.active) then raise exception 'Select a valid current Region II barangay'; end if;
  perform pg_advisory_xact_lock(8274301);
  select id into contact from public.rg_contacts where phone=p_phone;
  if contact is null and (select count(*) from public.rg_contacts)>=100 then raise exception 'Pilot contact limit reached'; end if;
  if exists(select 1 from public.rg_contacts where id=contact and account_id is not null and account_id<>p_user) then raise exception 'Contact already claimed'; end if;
  insert into public.rg_contacts(account_id,name,phone,location,barangay_code,consent,verified) values(p_user,p_name,p_phone,place,p_barangay,p_consent,true)
    on conflict(phone) do update set account_id=p_user,name=p_name,location=place,barangay_code=p_barangay,consent=p_consent,verified=true returning id into contact;
  insert into public.rg_consent_events(contact_id,consent,source,actor_id) values(contact,p_consent,'phone-verified-self-service-v1',p_user);
  if not p_consent then update public.rg_recipients set status='suppressed' where contact_id=contact and status='queued'; end if;
  return contact;
end $$;
revoke all on function public.rg_update_contact(uuid,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.rg_update_contact(uuid,text,text,boolean,text) to service_role;
