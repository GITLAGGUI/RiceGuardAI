// Weather + agronomy insights edge function.
// Wraps OpenWeather, caches results for 10 minutes in weather_cache,
// adds deterministic Tagalog agronomy insights (no AI).

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
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return jsonResponse({ error: "lat + lng required" }, 400);

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
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=metric&cnt=8`
    ),
  ]);

  if (!currentRes.ok || !forecastRes.ok) {
    return jsonResponse({ error: "openweather error" }, 502);
  }
  const current = await currentRes.json();
  const forecast = await forecastRes.json();

  const insights = buildInsights(current, forecast);
  const payload = { current, forecast5: forecast.list ?? [], agronomy_tl: insights };

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
  const temp = current.main?.temp ?? 0;
  const humidity = current.main?.humidity ?? 0;
  const wind = current.wind?.speed ?? 0;
  const pop = forecast.list?.[0]?.pop ?? 0;

  if (humidity > 85 && temp >= 22 && temp <= 30) {
    out.push("Mataas ang panganib ng Rice Blast — humid at malamig-malamig.");
  }
  if (humidity > 90 && temp > 27) {
    out.push("Magandang panahon para sa BLB — mag-ingat sa malakas na ulan.");
  }
  if (wind < 5 && pop < 0.3) {
    out.push("Magandang oras mag-spray — mahina ang hangin at malabong umulan.");
  } else if (pop > 0.6) {
    out.push("Huwag mag-spray — malamang umulan sa susunod na oras.");
  }
  if (wind > 8) {
    out.push("Malakas ang hangin — masamang oras para sa spraying.");
  }

  if (out.length === 0) out.push("Normal ang panahon. Magpatuloy sa pang-araw-araw na inspeksyon.");
  return out;
}
