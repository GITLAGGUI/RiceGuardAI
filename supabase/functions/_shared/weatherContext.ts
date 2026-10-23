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
