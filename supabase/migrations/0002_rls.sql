-- Row-level security for RiceGuard.
-- Every public table has RLS enabled. Use public.is_admin() helper from 0001.

-- ====== profiles ======
alter table public.profiles enable row level security;

create policy "profiles: self read"
  on public.profiles for select
  using (auth.uid() = id);
create policy "profiles: admin read all"
  on public.profiles for select
  using (public.is_admin());

create policy "profiles: self update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
create policy "profiles: admin update any"
  on public.profiles for update
  using (public.is_admin());

create policy "profiles: self insert"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ====== drone_scans (admin only) ======
alter table public.drone_scans enable row level security;

create policy "scans: admin all"
  on public.drone_scans for all
  using (public.is_admin())
  with check (public.is_admin());

-- ====== disease_detections ======
alter table public.disease_detections enable row level security;

create policy "detections: admin all"
  on public.disease_detections for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "detections: farmer own read"
  on public.disease_detections for select
  using (farmer_id = auth.uid());

-- ====== advisories ======
alter table public.advisories enable row level security;

create policy "advisories: admin all"
  on public.advisories for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "advisories: farmer own read"
  on public.advisories for select
  using (farmer_id = auth.uid());

-- ====== notification_preferences (self only) ======
alter table public.notification_preferences enable row level security;

create policy "prefs: self read"
  on public.notification_preferences for select
  using (farmer_id = auth.uid());
create policy "prefs: self upsert"
  on public.notification_preferences for insert
  with check (farmer_id = auth.uid());
create policy "prefs: self update"
  on public.notification_preferences for update
  using (farmer_id = auth.uid())
  with check (farmer_id = auth.uid());

-- ====== login_audit (admin only) ======
alter table public.login_audit enable row level security;
create policy "audit: admin read"
  on public.login_audit for select
  using (public.is_admin());

-- ====== weather_cache + rate_limits ======
-- Server-side only; lock down to service_role via no policies (RLS on, none granted).
alter table public.weather_cache enable row level security;
alter table public.rate_limits enable row level security;

-- ====== Storage bucket: scans (private) ======
insert into storage.buckets (id, name, public)
values ('scans', 'scans', false)
on conflict (id) do nothing;

create policy "scans bucket: admin upload"
  on storage.objects for insert
  with check (
    bucket_id = 'scans' and public.is_admin()
  );
create policy "scans bucket: admin read"
  on storage.objects for select
  using (
    bucket_id = 'scans' and public.is_admin()
  );
