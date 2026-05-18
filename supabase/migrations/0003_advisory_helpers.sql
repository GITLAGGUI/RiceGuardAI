-- Helper RPCs and SQL functions used by the admin advisory workflow.
-- Depends on 0001 (tables, enums) and 0002 (RLS).

-- ====== profiles: add geo columns so we can search by distance ======
-- For v1 we only store a single coord per farmer (their farm centroid).
-- Could be extended to polygons later.
alter table public.profiles
  add column if not exists lat double precision,
  add column if not exists lng double precision;

create index if not exists profiles_geo_idx
  on public.profiles using gist (ll_to_earth(lat, lng));

-- ====== find_nearby_farmers(lat, lng, radius_km) ======
-- Returns active farmers within radius_km of the given point, sorted by distance.
create or replace function public.find_nearby_farmers(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 10
)
returns table (
  id uuid,
  full_name text,
  phone text,
  barangay text,
  municipality text,
  province text,
  distance_km double precision
)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.full_name,
    p.phone,
    p.barangay,
    p.municipality,
    p.province,
    earth_distance(
      ll_to_earth(p.lat, p.lng),
      ll_to_earth(p_lat, p_lng)
    ) / 1000.0 as distance_km
  from public.profiles p
  where p.role = 'farmer'
    and p.is_active = true
    and p.lat is not null
    and p.lng is not null
    and earth_box(ll_to_earth(p_lat, p_lng), p_radius_km * 1000) @> ll_to_earth(p.lat, p.lng)
    and earth_distance(ll_to_earth(p.lat, p.lng), ll_to_earth(p_lat, p_lng)) <= p_radius_km * 1000
  order by distance_km asc
  limit 50;
$$;

revoke all on function public.find_nearby_farmers from public;
grant execute on function public.find_nearby_farmers to authenticated;

-- ====== get_advisory_context(advisory_id) ======
-- Convenience read-model for the AdvisoryCompose page: one query for
-- advisory + detection coords + farmer phone + recent weather hint.
create or replace function public.get_advisory_context(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'advisory', to_jsonb(a),
    'detection', to_jsonb(d),
    'farmer', jsonb_build_object(
      'id', f.id,
      'full_name', f.full_name,
      'phone', f.phone,
      'barangay', f.barangay,
      'municipality', f.municipality,
      'sms_enabled', coalesce(np.sms_enabled, true),
      'critical_alerts', coalesce(np.critical_alerts, true)
    )
  )
  from public.advisories a
  left join public.disease_detections d on d.id = a.detection_id
  left join public.profiles f on f.id = a.farmer_id
  left join public.notification_preferences np on np.farmer_id = a.farmer_id
  where a.id = p_id;
$$;

revoke all on function public.get_advisory_context from public;
grant execute on function public.get_advisory_context to authenticated;

-- ====== count_pending_advisories() — used for admin dashboard badge ======
create or replace function public.count_pending_advisories()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer
  from public.advisories
  where state in ('draft', 'approved');
$$;

revoke all on function public.count_pending_advisories from public;
grant execute on function public.count_pending_advisories to authenticated;

-- ====== assign_farmer_to_detection(detection_id) ======
-- Auto-assigns the nearest active farmer to a detection.  Called optionally
-- after admin commits a scan, before generating advisories.
create or replace function public.assign_farmer_to_detection(p_detection_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_farmer uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  select lat, lng into v_lat, v_lng
  from public.disease_detections where id = p_detection_id;

  if v_lat is null or v_lng is null then return null; end if;

  select id into v_farmer
  from public.find_nearby_farmers(v_lat, v_lng, 10)
  limit 1;

  if v_farmer is not null then
    update public.disease_detections
      set farmer_id = v_farmer
      where id = p_detection_id;
  end if;

  return v_farmer;
end;
$$;

revoke all on function public.assign_farmer_to_detection from public;
grant execute on function public.assign_farmer_to_detection to authenticated;
