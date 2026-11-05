-- Local-dev seed. Loaded automatically by `supabase start`.
-- Does NOT run on `supabase db push` (production migrations).
-- Safe to re-run; everything is idempotent.

do $$
declare
  v_uid uuid;
begin
  -- Sample farmer 1: Ilagan, Isabela
  v_uid := gen_random_uuid();
  insert into auth.users (id, instance_id, phone, phone_confirmed_at, aud, role, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (
    v_uid, '00000000-0000-0000-0000-000000000000',
    '+639170000001', now(), 'authenticated', 'authenticated', now(), now(),
    '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb
  ) on conflict (phone) do nothing;

  insert into public.profiles (id, phone, full_name, role, province, municipality, barangay, farm_size_ha, lat, lng, is_active)
  select v_uid, '+639170000001', 'Juan Dela Cruz', 'farmer', 'Isabela', 'Ilagan', 'San Vicente', 1.2, 17.1485, 121.8907, true
  where exists (select 1 from auth.users where id = v_uid)
  on conflict (phone) do nothing;

  -- Sample farmer 2: Tuguegarao, Cagayan
  v_uid := gen_random_uuid();
  insert into auth.users (id, instance_id, phone, phone_confirmed_at, aud, role, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (
    v_uid, '00000000-0000-0000-0000-000000000000',
    '+639170000002', now(), 'authenticated', 'authenticated', now(), now(),
    '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb
  ) on conflict (phone) do nothing;

  insert into public.profiles (id, phone, full_name, role, province, municipality, barangay, farm_size_ha, lat, lng, is_active)
  select v_uid, '+639170000002', 'Maria Santos', 'farmer', 'Cagayan', 'Tuguegarao', 'Carig Norte', 2.5, 17.6131, 121.7270, true
  where exists (select 1 from auth.users where id = v_uid)
  on conflict (phone) do nothing;

  -- Sample farmer 3: Cauayan, Isabela
  v_uid := gen_random_uuid();
  insert into auth.users (id, instance_id, phone, phone_confirmed_at, aud, role, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (
    v_uid, '00000000-0000-0000-0000-000000000000',
    '+639170000003', now(), 'authenticated', 'authenticated', now(), now(),
    '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb
  ) on conflict (phone) do nothing;

  insert into public.profiles (id, phone, full_name, role, province, municipality, barangay, farm_size_ha, lat, lng, is_active)
  select v_uid, '+639170000003', 'Pedro Reyes', 'farmer', 'Isabela', 'Cauayan', 'San Fermin', 0.8, 16.9342, 121.7714, true
  where exists (select 1 from auth.users where id = v_uid)
  on conflict (phone) do nothing;
end $$;

-- Default notification prefs for any farmer who doesn't have one yet.
insert into public.notification_preferences (farmer_id, sms_enabled, critical_alerts, weekly_summary)
select p.id, true, true, false
from public.profiles p
where p.role = 'farmer'
on conflict (farmer_id) do nothing;

-- GABAY: Local admin para sa debugging (local Docker database LANG; hindi ito tumatakbo sa production).
-- Login sa http://localhost:5173/login habang naka-`npm run dev:local`:
--   email:    local-admin@riceguard.test
--   password: 123456
-- Walang MFA sa local (LOCAL_SKIP_MFA). Sa production, kailangan pa rin ng authenticator app.
do $$
declare
  v_uid uuid := '00000000-0000-4000-8000-00000000ad01';
begin
  insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, aud, role,
                          created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_uid, '00000000-0000-0000-0000-000000000000', 'local-admin@riceguard.test',
          extensions.crypt('123456', extensions.gen_salt('bf')), now(), 'authenticated', 'authenticated',
          now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Local Dev Admin"}'::jsonb)
  on conflict (id) do nothing;
  -- Kailangang '' (hindi NULL) ang mga token column na ito, kung hindi ay "Database error querying schema" sa login.
  update auth.users set confirmation_token = '', recovery_token = '', email_change = '', email_change_token_new = '',
    email_change_token_current = '', phone_change = '', phone_change_token = '', reauthentication_token = ''
  where id = v_uid;

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
  values (gen_random_uuid(), v_uid, v_uid::text, 'email',
          jsonb_build_object('sub', v_uid::text, 'email', 'local-admin@riceguard.test', 'email_verified', true), now(), now())
  on conflict do nothing;

  insert into public.profiles (id, phone, full_name, role, is_active)
  values (v_uid, '+639170000099', 'Local Dev Admin', 'admin', true)
  on conflict (id) do update set role = 'admin', is_active = true;
end $$;
