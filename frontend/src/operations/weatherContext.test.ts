import { describe, expect, it } from "vitest";
import { buildWeatherInsights, normalizeWeatherContext } from "../../../supabase/functions/_shared/weatherContext";

const now = Date.parse("2026-09-28T08:00:00Z");
describe("advisory weather context", () => {
  it("preserves zero readings and only fresh observations", () => {
    const weather = normalizeWeatherContext({ current: { dt: now / 1000 - 600, main: { temp: 0, humidity: 0 }, wind: { speed: 0 }, rain: { "1h": 0 } } }, now);
    expect((weather?.observation as { temperature_c: number }).temperature_c).toBe(0);
    expect(weather?.disease_risk_calibrated).toBe(false);
    expect(normalizeWeatherContext({ current: { dt: now / 1000 - 7200, main: { temp: 29 } } }, now)).toBeNull();
  });
  it("does not claim missing precipitation is zero or accept expired forecasts", () => {
    const weather = normalizeWeatherContext({ current: { dt: now / 1000, main: { temp: 29 } }, forecast5: [
      { dt: now / 1000 - 1, pop: 0.9 }, { dt: now / 1000 + 10800, pop: 0.3 }, { dt: now / 1000 + 90000, pop: 0.8 },
    ] }, now);
    expect((weather?.observation as { rain_1h_mm: unknown }).rain_1h_mm).toBeNull();
    expect((weather?.forecast_3hour_intervals as unknown[]).length).toBe(1);
  });
  it("never equates missing indicators with normal weather", () => {
    expect(buildWeatherInsights({}, {})).toEqual([expect.stringContaining("Hindi ito patunay")]);
    expect(buildWeatherInsights({ wind: { speed: 10 } }, {})).toEqual([expect.stringContaining("Malakas ang hangin")]);
  });
});
