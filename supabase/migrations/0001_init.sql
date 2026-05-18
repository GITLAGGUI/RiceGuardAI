-- RiceGuard AI · initial schema
-- Replaces the old PHP/MySQL schema. Identity comes from auth.users.

-- ====== Extensions (must come BEFORE indexes that use earthdistance/cube) ======
create extension if not exists cube;
create extension if not exists earthdistance;

-- ====== Enums ======
create type user_role      as enum ('farmer', 'admin');
create type disease        as enum ('rice_blast', 'bacterial_leaf_blight', 'tungro');
create type severity       as enum ('low', 'medium', 'high');
create type scan_status    as enum ('pending', 'processing', 'completed');
create type delivery       as enum ('queued', 'sent', 'failed');
create type advisory_state as enum ('draft', 'approved', 'sent');

-- ====== profiles ======
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  phone         text unique not null,
  role          user_role not null default 'farmer',
  province      text,
  municipality  text,
  barangay      text,
  farm_size_ha  numeric(6,2),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index on public.profiles (role);
create index on public.profiles (province, municipality, barangay);

-- ====== drone_scans ======
create table public.drone_scans (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid not null references public.profiles(id) on delete cascade,
  scan_name     text not null,
  source_type   text,
  stored_path   text,
  captured_at   timestamptz,
  processed_at  timestamptz,
  status        scan_status not null default 'pending',
  created_at    timestamptz not null default now()
);
create index on public.drone_scans (admin_id);
create index on public.drone_scans (captured_at desc);

-- ====== disease_detections ======
create table public.disease_detections (
  id                uuid primary key default gen_random_uuid(),
  scan_id           uuid not null references public.drone_scans(id) on delete cascade,
  farmer_id         uuid references public.profiles(id) on delete set null,
  disease           disease not null,
  severity          severity not null,
  lat               double precision not null,
  lng               double precision not null,
  location_text     text,
  confidence_score  numeric(4,3),
  affected_area_pct numeric(5,2),
  bbox_json         jsonb,
  image_url         text,
  created_at        timestamptz not null default now()
);
create index on public.disease_detections (scan_id);
create index on public.disease_detections (farmer_id);
create index on public.disease_detections (disease, severity);
create index on public.disease_detections using gist (
  ll_to_earth(lat, lng)
);

-- ====== advisories (collapses old alert_history) ======
create table public.advisories (
  id            uuid primary key default gen_random_uuid(),
  detection_id  uuid references public.disease_detections(id) on delete set null,
  farmer_id     uuid references public.profiles(id) on delete cascade,
  admin_id      uuid references public.profiles(id) on delete set null,
  disease       disease not null,
  severity      severity not null,
  advice_text   text,
  sms_text      text,
  ai_generated  boolean not null default true,
  ai_model      text,
  state         advisory_state not null default 'draft',
  sms_status    delivery,
  sms_sent_at   timestamptz,
  sms_error     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.advisories (farmer_id);
create index on public.advisories (state);
create index on public.advisories (created_at desc);

-- ====== notification_preferences ======
create table public.notification_preferences (
  farmer_id        uuid primary key references public.profiles(id) on delete cascade,
  sms_enabled      boolean not null default true,
  critical_alerts  boolean not null default true,
  weekly_summary   boolean not null default false,
  updated_at       timestamptz not null default now()
);

-- ====== login_audit ======
create table public.login_audit (
  id          bigserial primary key,
  user_id     uuid references auth.users(id) on delete set null,
  phone       text,
  event       text not null,
  ip          inet,
  ua          text,
  created_at  timestamptz not null default now()
);
create index on public.login_audit (phone, created_at desc);

-- ====== weather_cache (used by `weather` edge fn) ======
create table public.weather_cache (
  key         text primary key,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now()
);

-- ====== rate_limits (used by edge fns) ======
create table public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  count         integer not null default 0,
  primary key (key, window_start)
);

-- ====== Helper: is_admin() — used by every RLS policy ======
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ====== Updated-at trigger ======
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger advisories_updated_at
  before update on public.advisories
  for each row execute function public.set_updated_at();

create trigger notification_prefs_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- ====== Mirror auth.users.phone → profiles.phone on user create ======
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  -- Only auto-create row if none exists yet; let app finish profile via /register.
  insert into public.profiles (id, phone, role, is_active)
  values (new.id, coalesce(new.phone, ''), 'farmer', true)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ====== RPC: create_scan_with_detections ======
-- Inserts one scan + N detections atomically. Called from the admin marker UI.
create or replace function public.create_scan_with_detections(
  p_scan        jsonb,
  p_detections  jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_scan_id      uuid;
  v_detection_id uuid;
  v_ids          uuid[] := '{}';
  v_detection    jsonb;
begin
  if not public.is_admin() then
    raise exception 'only admins can create scans';
  end if;

  insert into public.drone_scans (
    admin_id, scan_name, source_type, stored_path, captured_at, status
  ) values (
    auth.uid(),
    (p_scan->>'scan_name'),
    coalesce(p_scan->>'source_type', 'manual'),
    (p_scan->>'stored_path'),
    nullif(p_scan->>'captured_at', '')::timestamptz,
    'completed'
  ) returning id into v_scan_id;

  for v_detection in select * from jsonb_array_elements(p_detections) loop
    insert into public.disease_detections (
      scan_id, disease, severity, lat, lng,
      location_text, confidence_score
    ) values (
      v_scan_id,
      (v_detection->>'disease')::disease,
      (v_detection->>'severity')::severity,
      (v_detection->>'lat')::double precision,
      (v_detection->>'lng')::double precision,
      v_detection->>'location_text',
      nullif(v_detection->>'confidence_score','')::numeric
    ) returning id into v_detection_id;
    v_ids := array_append(v_ids, v_detection_id);
  end loop;

  return jsonb_build_object('scan_id', v_scan_id, 'detection_ids', to_jsonb(v_ids));
end;
$$;
