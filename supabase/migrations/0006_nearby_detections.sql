-- Used by the weekly-digest Edge Function.

create or replace function public.find_nearby_detections(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 10,
  p_since timestamptz default (now() - interval '7 days')
)
returns table (
  id uuid,
  disease disease,
  severity severity,
  lat double precision,
  lng double precision,
  distance_km double precision,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    d.id, d.disease, d.severity, d.lat, d.lng,
    earth_distance(ll_to_earth(d.lat, d.lng), ll_to_earth(p_lat, p_lng)) / 1000.0 as distance_km,
    d.created_at
  from public.disease_detections d
  where d.created_at >= p_since
    and earth_box(ll_to_earth(p_lat, p_lng), p_radius_km * 1000) @> ll_to_earth(d.lat, d.lng)
    and earth_distance(ll_to_earth(d.lat, d.lng), ll_to_earth(p_lat, p_lng)) <= p_radius_km * 1000
  order by d.created_at desc
  limit 200;
$$;

revoke all on function public.find_nearby_detections from public;
grant execute on function public.find_nearby_detections to authenticated, service_role;
