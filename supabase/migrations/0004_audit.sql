-- Audit log for admin actions: advisory generation, SMS sends, profile changes,
-- scan creation. Used by the admin Settings → Activity page and forensics.

create table public.audit_events (
  id            bigserial primary key,
  actor_id      uuid references public.profiles(id) on delete set null,
  action        text not null,                    -- e.g. 'advisory.generate', 'sms.sent', 'scan.create'
  target_table  text,                              -- e.g. 'advisories', 'drone_scans'
  target_id     uuid,
  meta          jsonb,
  created_at    timestamptz not null default now()
);
create index on public.audit_events (actor_id, created_at desc);
create index on public.audit_events (action, created_at desc);
create index on public.audit_events (target_table, target_id);

alter table public.audit_events enable row level security;

create policy "audit: admin read"
  on public.audit_events for select
  using (public.is_admin());

-- Service-role-only insert (no policy needed; service_role bypasses RLS).
-- Authenticated callers cannot insert directly; Edge Functions write via the
-- service role client.

-- ====== Trigger: log scan creation ======
create or replace function public.audit_scan_create()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events (actor_id, action, target_table, target_id, meta)
  values (
    new.admin_id,
    'scan.create',
    'drone_scans',
    new.id,
    jsonb_build_object('scan_name', new.scan_name, 'source', new.source_type)
  );
  return new;
end;
$$;

create trigger drone_scans_audit
  after insert on public.drone_scans
  for each row execute function public.audit_scan_create();

-- ====== Trigger: log advisory state transitions ======
create or replace function public.audit_advisory_state()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.state is distinct from new.state then
    insert into public.audit_events (actor_id, action, target_table, target_id, meta)
    values (
      coalesce(new.admin_id, old.admin_id),
      'advisory.state_change',
      'advisories',
      new.id,
      jsonb_build_object('from', old.state, 'to', new.state)
    );
  end if;
  return new;
end;
$$;

create trigger advisories_state_audit
  after update on public.advisories
  for each row execute function public.audit_advisory_state();
