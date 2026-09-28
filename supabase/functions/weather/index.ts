// Weather + agronomy insights edge function.
// Wraps OpenWeather, caches results for 10 minutes in weather_cache,
// adds conservative Tagalog weather context (no AI or calibrated disease risk).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";
import { handleCors, jsonResponse } from "../_shared/cors.ts";

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
  if (req.method !== "GET") return jsonResponse({ error: "method not allowed" }, 405);

  if (!OPENWEATHER_API_KEY)
    return jsonResponse({ error: "openweather not configured" }, 500);

  const url = new URL(req.url);
  const latText = url.searchParams.get("lat");
  const lngText = url.searchParams.get("lng");
  if (!latText?.trim() || !lngText?.trim())
    return jsonResponse({ error: "lat + lng required" }, 400);
  const lat = Number(latText);
  const lng = Number(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return jsonResponse({ error: "Invalid geographic coordinates" }, 400);

  const key = `${lat.toFixed(3)}:${lng.toFixed(3)}`;
  const { data: cached } = await admin
    .from("weather_cache")
    .select("payload, fetched_at")
    .eq("key", key)
    .maybeSingle();

  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) {
    return jsonResponse(cached.payload);
  }

  const [currentRes, forecastRes] = await Promise.all([
    fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=metric`
    ),
    fetch(
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=metric&cnt=24`
    ),
  ]);

  if (!currentRes.ok || !forecastRes.ok) {
    return jsonResponse({ error: "openweather error" }, 502);
  }
  const current = await currentRes.json();
  const forecast = await forecastRes.json();

  const insights = buildInsights(current, forecast);
  // Keep forecast5 for existing clients; 24 three-hour steps cover up to 72 hours.
  const payload = {
    current,
    forecast5: forecast.list ?? [],
    agronomy_tl: insights,
    weather_meta: {
      provider: "OpenWeather",
      units: "metric",
      requested_lat: lat,
      requested_lng: lng,
      fetched_at: new Date().toISOString(),
      observed_at: Number.isFinite(Number(current?.dt)) ? new Date(Number(current.dt) * 1000).toISOString() : null,
      forecast_step_hours: 3,
      forecast_horizon_hours: 72,
      disease_risk_calibrated: false,
    },
  };

  await admin
    .from("weather_cache")
    .upsert({ key, payload, fetched_at: new Date().toISOString() });

  return jsonResponse(payload);
});

interface OwmCurrent {
  main?: { temp?: number; humidity?: number };
  wind?: { speed?: number };
  rain?: { "1h"?: number };
  weather?: Array<{ description?: string }>;
}
interface OwmForecast {
  list?: Array<{ pop?: number; main?: { humidity?: number } }>;
}

function buildInsights(current: OwmCurrent, forecast: OwmForecast): string[] {
  const out: string[] = [];
  const temp = current.main?.temp;
  const humidity = current.main?.humidity;
  const wind = current.wind?.speed;
  const pop = forecast.list?.[0]?.pop;

  if (typeof humidity === "number" && typeof temp === "number" && humidity > 85 && temp >= 22 && temp <= 30) {
    out.push("Mataas ang humidity; i-review ang field observations at approved disease guidance bago maglabas ng advisory.");
  }
  if (typeof humidity === "number" && typeof temp === "number" && humidity > 90 && temp > 27) {
    out.push("Mainit at napakataas ng humidity; dagdagan ang visual monitoring pagkatapos ng ulan.");
  }
  if (typeof wind === "number" && typeof pop === "number" && wind < 5 && pop < 0.3) {
    out.push("Mahina ang hangin at mababa ang kasalukuyang rain probability; i-record ito bilang survey context.");
  } else if (typeof pop === "number" && pop > 0.6) {
    out.push("Mataas ang rain probability; maaaring maapektuhan ang image quality at field access.");
  }
  if (typeof wind === "number" && wind > 8) {
    out.push("Malakas ang hangin; ipagpaliban ang drone capture kung hindi ligtas ang paglipad.");
  }

  if (out.length === 0) out.push("Walang sapat na batayan sa available weather indicators para sa espesyal na alerto. Patuloy na obserbahan ang palay; hindi ito patunay na ligtas sa sakit.");
  return out;
}
