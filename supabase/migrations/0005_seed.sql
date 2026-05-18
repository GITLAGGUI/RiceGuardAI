-- Production-safe seed: default notification preferences for any farmer
-- that doesn't have one yet. Re-runnable; safe on hosted Supabase.
--
-- The dev-only auth.users + sample-farmer seed lives in supabase/seed.sql
-- (loaded only by `supabase start`, not by `supabase db push`).

insert into public.notification_preferences (farmer_id, sms_enabled, critical_alerts, weekly_summary)
select p.id, true, true, false
from public.profiles p
where p.role = 'farmer'
on conflict (farmer_id) do nothing;
