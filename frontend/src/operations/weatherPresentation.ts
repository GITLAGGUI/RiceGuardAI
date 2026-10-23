export type BulletinWeather = {
  condition: string;
  temperatureC: number | null;
  humidityPct: number | null;
  windMS: number | null;
  rainChancePct: number | null;
  observedAt: string | null;
  insights: string[];
};

const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function weatherForBulletin(payload: unknown): BulletinWeather | null {
  const data = payload as {
    current?: {
      dt?: unknown;
      main?: { temp?: unknown; humidity?: unknown };
      wind?: { speed?: unknown };
      weather?: Array<{ description?: unknown }>;
    };
    forecast5?: Array<{ pop?: unknown }>;
    agronomy_tl?: unknown;
    weather_meta?: { observed_at?: unknown };
  } | null;
  if (!data?.current) return null;

  const temperatureC = finite(data.current.main?.temp);
  const humidityPct = finite(data.current.main?.humidity);
  const windMS = finite(data.current.wind?.speed);
  const rainValue = finite(data.forecast5?.[0]?.pop);
  const rainProbability = rainValue !== null && rainValue >= 0 && rainValue <= 1 ? rainValue : null;
  const description = data.current.weather?.[0]?.description;
  const observedAt = typeof data.weather_meta?.observed_at === "string"
    ? data.weather_meta.observed_at
    : typeof data.current.dt === "number" && Number.isFinite(data.current.dt)
      ? new Date(data.current.dt * 1000).toISOString()
      : null;
  const insights = Array.isArray(data.agronomy_tl)
    ? data.agronomy_tl.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];

  if (temperatureC === null && humidityPct === null && windMS === null && rainProbability === null)
    return null;

  return {
    condition: typeof description === "string" && description.trim()
      ? description.trim().replace(/^./, (character) => character.toUpperCase())
      : "Nearby conditions",
    temperatureC,
    humidityPct,
    windMS,
    rainChancePct: rainProbability === null ? null : Math.round(rainProbability * 100),
    observedAt,
    insights,
  };
}
