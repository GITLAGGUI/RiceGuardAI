/** Weather is nearby context, never a diagnosis or a calibrated disease-risk score. */
export function buildWeatherInsights(current: unknown, forecast: unknown): string[] {
  const observation = current as { main?: { temp?: unknown; humidity?: unknown }; wind?: { speed?: unknown } } | null;
  const outlook = forecast as { list?: Array<{ pop?: unknown }> } | null;
  const temp = observation?.main?.temp;
  const humidity = observation?.main?.humidity;
  const wind = observation?.wind?.speed;
  const pop = outlook?.list?.[0]?.pop;
  const out: string[] = [];
  if (typeof humidity === "number" && typeof temp === "number" && humidity > 85 && temp >= 22 && temp <= 30)
    out.push("Mataas ang humidity; i-review ang field observations at approved disease guidance bago maglabas ng advisory.");
  if (typeof humidity === "number" && typeof temp === "number" && humidity > 90 && temp > 27)
    out.push("Mainit at napakataas ng humidity; dagdagan ang visual monitoring pagkatapos ng ulan.");
  if (typeof wind === "number" && typeof pop === "number" && wind < 5 && pop < 0.3)
    out.push("Mahina ang hangin at mababa ang kasalukuyang rain probability; i-record ito bilang survey context.");
  else if (typeof pop === "number" && pop > 0.6)
    out.push("Mataas ang rain probability; maaaring maapektuhan ang image quality at field access.");
  if (typeof wind === "number" && wind > 8)
    out.push("Malakas ang hangin; ipagpaliban ang drone capture kung hindi ligtas ang paglipad.");
  if (!out.length) out.push("Walang sapat na batayan sa available weather indicators para sa espesyal na alerto. Hindi ito patunay na ligtas sa sakit.");
  return out;
}

export function normalizeWeatherContext(payload: unknown, nowMs: number): Record<string, unknown> | null {
  if (!Number.isFinite(nowMs)) return null;
  const value = payload as { current?: Record<string, unknown>; forecast5?: unknown } | null;
  const current = value?.current;
  const observedSeconds = typeof current?.dt === "number" ? current.dt : NaN;
  const observationFresh = Number.isFinite(observedSeconds) && observedSeconds * 1000 <= nowMs + 5 * 60_000 &&
    observedSeconds * 1000 >= nowMs - 30 * 60_000;
  const main = current?.main as Record<string, unknown> | undefined;
  const wind = current?.wind as Record<string, unknown> | undefined;
  const rain = current?.rain as Record<string, unknown> | undefined;
  const finite = (input: unknown) => typeof input === "number" && Number.isFinite(input) ? input : null;
  const observation = observationFresh ? {
    observed_at: new Date(observedSeconds * 1000).toISOString(),
    temperature_c: finite(main?.temp),
    humidity_pct: finite(main?.humidity),
    wind_m_s: finite(wind?.speed),
    rain_1h_mm: finite(rain?.["1h"]),
    conditions: Array.isArray(current?.weather) ? String((current!.weather as Array<Record<string, unknown>>)[0]?.description ?? "") || null : null,
    clouds_pct: finite((current?.clouds as Record<string, unknown> | undefined)?.all),
  } : null;
  const steps = Array.isArray(value?.forecast5) ? value.forecast5 : [];
  const forecast = steps.flatMap((raw) => {
    const step = raw as Record<string, unknown>;
    const at = step.dt;
    if (typeof at !== "number" || !Number.isFinite(at) || at * 1000 <= nowMs || at * 1000 > nowMs + 24 * 60 * 60_000)
      return [];
    const stepMain = step.main as Record<string, unknown> | undefined;
    const stepWind = step.wind as Record<string, unknown> | undefined;
    const stepRain = step.rain as Record<string, unknown> | undefined;
    return [{ forecast_at: new Date(at * 1000).toISOString(), temperature_c: finite(stepMain?.temp),
      humidity_pct: finite(stepMain?.humidity), wind_m_s: finite(stepWind?.speed),
      precipitation_probability: finite(step.pop), rain_3h_mm: finite(stepRain?.["3h"]) }];
  }).slice(0, 8);
  if (!observation && !forecast.length) return null;
  return {
    provider: "OpenWeather",
    spatial_scope: "Nearby point rounded to approximately 0.01 degree, not an on-field sensor",
    observation,
    forecast_3hour_intervals: forecast,
    disease_risk_calibrated: false,
  };
}

type Step = { forecast_at: string; temperature_c: number | null; humidity_pct: number | null; wind_m_s: number | null;
  precipitation_probability: number | null; rain_3h_mm: number | null };

/**
 * Plain facts an advisory writer can act on: what the weather is now and over the next 24 hours.
 * The disease notes are general agronomy (IRRI/PhilRice), not a calibrated risk score.
 */
export function weatherBrief(context: unknown): Record<string, unknown> | null {
  const value = context as { observation?: Record<string, unknown> | null; forecast_3hour_intervals?: Step[] } | null;
  if (!value) return null;
  const now = value.observation || null;
  const steps = Array.isArray(value.forecast_3hour_intervals) ? value.forecast_3hour_intervals : [];
  const nums = (pick: (s: Step) => number | null) => steps.map(pick).filter((n): n is number => typeof n === "number");
  const rain = nums((s) => s.rain_3h_mm ?? 0);
  const pop = nums((s) => s.precipitation_probability);
  const humid = nums((s) => s.humidity_pct);
  const wind = nums((s) => s.wind_m_s);
  const temps = nums((s) => s.temperature_c);
  const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
  const firstRain = steps.find((s) => (s.precipitation_probability ?? 0) >= 0.5 || (s.rain_3h_mm ?? 0) >= 1);
  const next24 = steps.length ? {
    total_rain_mm: round(rain.reduce((a, b) => a + b, 0)),
    max_rain_chance_pct: pop.length ? Math.round(Math.max(...pop) * 100) : null,
    likely_rain_starts_at: firstRain?.forecast_at ?? null,
    hours_with_humidity_85_plus: humid.filter((h) => h >= 85).length * 3,
    max_wind_m_s: wind.length ? round(Math.max(...wind)) : null,
    temperature_range_c: temps.length ? [round(Math.min(...temps)), round(Math.max(...temps))] : null,
  } : null;
  const notes: string[] = [];
  const wet = (next24?.total_rain_mm ?? 0) >= 5 || (next24?.max_rain_chance_pct ?? 0) >= 60 || (now?.rain_1h_mm as number ?? 0) > 0;
  const humidNow = typeof now?.humidity_pct === "number" && (now.humidity_pct as number) >= 85;
  if (wet) notes.push("Rain is likely within 24 h: BLB bacteria spread with rain splash, wind-driven rain and floodwater; sprays applied right before rain wash off.");
  if (humidNow || (next24?.hours_with_humidity_85_plus ?? 0) >= 12) notes.push("Long humid periods keep leaves wet, which favours Brown Spot and BLB development.");
  if ((next24?.max_wind_m_s ?? 0) >= 6) notes.push("Strong wind: leaves rub and tear, giving BLB entry wounds; avoid spraying or flying in strong wind.");
  if (!wet && !humidNow) notes.push("Dry spell expected: a good window for field work, drainage and any recommended application.");
  return { provider: "OpenWeather", now, next_24h: next24, agronomy_notes: notes,
    scope: "Nearby weather point, not an on-field sensor. Use it to time actions, not to diagnose." };
}
