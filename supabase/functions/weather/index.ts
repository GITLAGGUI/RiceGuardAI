// Weather + agronomy insights edge function.
// Wraps OpenWeather, caches results for 10 minutes in weather_cache,
// adds conservative Tagalog weather context (no AI or calibrated disease risk).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { buildWeatherInsights } from "../_shared/weatherContext.ts";
import regionWeatherPoints from "../_shared/regionIIWeatherPoints.json" with { type: "json" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENWEATHER_API_KEY = Deno.env.get("OPENWEATHER_API_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const CACHE_TTL_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "GET" && req.method !== "POST")
    return jsonResponse({ error: "method not allowed" }, 405);

  if (!OPENWEATHER_API_KEY)
    return jsonResponse({ error: "openweather not configured" }, 500);

  const url = new URL(req.url);
  let requestBody: { lat?: unknown; lng?: unknown; location_code?: unknown } = {};
  if (req.method === "POST") {
    try {
      requestBody = await req.json();
    } catch {
      return jsonResponse({ error: "valid JSON body required" }, 400);
    }
  }
  let latInput = req.method === "POST" ? requestBody.lat : url.searchParams.get("lat");
  let lngInput = req.method === "POST" ? requestBody.lng : url.searchParams.get("lng");
  let locationMeta: { code: string; label: string; scope: string } | null = null;
  const locationCode = req.method === "POST" ? requestBody.location_code : url.searchParams.get("location_code");
  try {
    if (locationCode != null) {
      if (typeof locationCode !== "string" || !/^02\d{8}$/.test(locationCode))
        return jsonResponse({ error: "Select a current Region II location" }, 400);
      let { data: location } = await admin.from("rg_locations")
        .select("code,name,level,parent_code,rg_location_releases!inner(active)")
        .eq("code", locationCode).eq("rg_location_releases.active", true).maybeSingle();
      if (location?.level === "barangay") {
        const { data } = await admin.from("rg_locations").select("code,name,level,parent_code,rg_location_releases!inner(active)")
          .eq("code", location.parent_code).eq("rg_location_releases.active", true).maybeSingle();
        location = data;
      }
      if (location?.level !== "municipality") return jsonResponse({ error: "Select a Region II municipality" }, 400);
      const { data: province } = await admin.from("rg_locations").select("code,name")
        .eq("code", location.parent_code).maybeSingle();
      if (!province) return jsonResponse({ error: "Location province unavailable" }, 400);
      locationMeta = { code: location.code, label: `${location.name}, ${province.name}`, scope: "municipality_nearby_point" };
      const representative = (regionWeatherPoints.points as Record<string, { province_code: string; lat: number; lng: number }>)[location.code];
      const geoKey = `weather-location:${location.code}`;
      const { data: geo } = await admin.from("weather_cache").select("payload,fetched_at").eq("key", geoKey).maybeSingle();
      if (representative && representative.province_code === province.code) {
        latInput = representative.lat;
        lngInput = representative.lng;
        locationMeta.scope = "municipality_representative_nearby_point";
      } else if (geo && Date.now() - Date.parse(geo.fetched_at) < 30 * 24 * 60 * 60_000) {
        latInput = geo.payload.lat;
        lngInput = geo.payload.lng;
      } else {
        const cityName = location.name.replace(/^City of /i, "").replace(/\s*\(.*\)$/, "");
        const geocode = await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(`${cityName},PH`)}&limit=5&appid=${OPENWEATHER_API_KEY}`, { signal: AbortSignal.timeout(12_000) });
        if (!geocode.ok) return jsonResponse({ error: "Weather location lookup unavailable" }, 502);
        const candidates = await geocode.json();
        let found = false;
        for (const candidate of Array.isArray(candidates) ? candidates : []) {
          if (candidate.country !== "PH") continue;
          const { data: valid, error: validationError } = await admin.rpc("rg_weather_point_in_province", {
            p_province: province.code, p_lat: candidate.lat, p_lng: candidate.lon,
          });
          if (validationError) return jsonResponse({ error: "Weather location validation unavailable" }, 503);
          if (!valid) continue;
          latInput = candidate.lat;
          lngInput = candidate.lon;
          found = true;
          break;
        }
        if (!found) return jsonResponse({ error: "No verified weather point for this municipality. Select a nearby municipality." }, 404);
        await admin.from("weather_cache").upsert({ key: geoKey, payload: { lat: latInput, lng: lngInput }, fetched_at: new Date().toISOString() });
      }
    }
  if (latInput === null || latInput === undefined || lngInput === null || lngInput === undefined)
    return jsonResponse({ error: "lat + lng required" }, 400);
  const lat = Number(latInput);
  const lng = Number(lngInput);
  if (latInput === "" || lngInput === "" || typeof latInput === "boolean" || typeof lngInput === "boolean" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return jsonResponse({ error: "Invalid geographic coordinates" }, 400);

  const key = `${lat.toFixed(3)}:${lng.toFixed(3)}`;
  const { data: cached } = await admin
    .from("weather_cache")
    .select("payload, fetched_at")
    .eq("key", key)
    .maybeSingle();

  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) {
    return jsonResponse({ ...cached.payload, location_meta: locationMeta });
  }

  const [currentRes, forecastRes] = await Promise.all([
    fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=metric`, { signal: AbortSignal.timeout(12_000) }
    ),
    fetch(
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=metric&cnt=8`, { signal: AbortSignal.timeout(12_000) }
    ),
  ]);

  if (!currentRes.ok || !forecastRes.ok) {
    return jsonResponse({ error: "openweather error" }, 502);
  }
  const current = await currentRes.json();
  const forecast = await forecastRes.json();

  const insights = buildWeatherInsights(current, forecast);
  const payload = { current, forecast5: forecast.list ?? [], agronomy_tl: insights,
    weather_meta: { provider: "OpenWeather", units: "metric", fetched_at: new Date().toISOString(),
      observed_at: typeof current?.dt === "number" && Number.isFinite(current.dt)
        ? new Date(current.dt * 1000).toISOString() : null,
      forecast_step_hours: 3, disease_risk_calibrated: false } };

  await admin
    .from("weather_cache")
    .upsert({ key, payload, fetched_at: new Date().toISOString() });

  return jsonResponse({ ...payload, location_meta: locationMeta });
  } catch {
    return jsonResponse({ error: "Weather service temporarily unavailable" }, 502);
  }
});
