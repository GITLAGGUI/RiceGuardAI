create or replace function public.rg_weather_point_in_province(p_province text,p_lat double precision,p_lng double precision)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.rg_coverage where province_code=p_province
    and extensions.st_covers(geometry,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)));
$$;
revoke all on function public.rg_weather_point_in_province(text,double precision,double precision) from public,anon,authenticated;
grant execute on function public.rg_weather_point_in_province(text,double precision,double precision) to service_role;
