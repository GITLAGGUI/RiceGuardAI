-- Protect legacy contact-returning helpers only. Public disease locations and
-- public bulletin/map projections are deliberately NOT changed.
create function private.rg_require_contact_admin() returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if current_setting('role',true)='service_role' then return; end if;
  if not exists(select 1 from public.profiles p
    where p.id=auth.uid() and p.role='admin' and p.is_active) then
    raise exception 'Active administrator required' using errcode='42501';
  end if;
end $$;
revoke all on function private.rg_require_contact_admin() from public,anon,authenticated;
grant execute on function private.rg_require_contact_admin() to service_role;

-- Keep the exact existing query bodies and their OIDs/dependencies, but remove
-- their direct Data API exposure. New public wrappers enforce authorization.
alter function public.find_nearby_farmers(double precision,double precision,double precision) set schema private;
alter function public.get_advisory_context(uuid) set schema private;
revoke all on function private.find_nearby_farmers(double precision,double precision,double precision),
  private.get_advisory_context(uuid) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.find_nearby_farmers(double precision,double precision,double precision),
  private.get_advisory_context(uuid) to service_role;

create function public.find_nearby_farmers(p_lat double precision,p_lng double precision,p_radius_km double precision default 10)
returns table(id uuid,full_name text,phone text,barangay text,municipality text,province text,distance_km double precision)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.rg_require_contact_admin();
  return query select * from private.find_nearby_farmers(p_lat,p_lng,p_radius_km);
end $$;
create function public.get_advisory_context(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.rg_require_contact_admin();
  return private.get_advisory_context(p_id);
end $$;
revoke all on function public.find_nearby_farmers(double precision,double precision,double precision),
  public.get_advisory_context(uuid) from public,anon,authenticated;
grant execute on function public.find_nearby_farmers(double precision,double precision,double precision),
  public.get_advisory_context(uuid) to authenticated,service_role;
