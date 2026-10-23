import { describe, expect, it } from "vitest";
import { weatherForBulletin } from "./weatherPresentation";

describe("bulletin weather presentation", () => {
  it("preserves valid zero values and converts probability to percent", () => {
    const value = weatherForBulletin({
      current: { dt: 1_800_000_000, main: { temp: 0, humidity: 0 }, wind: { speed: 0 }, weather: [{ description: "light rain" }] },
      forecast5: [{ pop: 0.64 }],
      agronomy_tl: ["Weather context only."],
      weather_meta: { observed_at: "2027-01-15T08:00:00.000Z" },
    });
    expect(value).toMatchObject({
      condition: "Light rain",
      temperatureC: 0,
      humidityPct: 0,
      windMS: 0,
      rainChancePct: 64,
      observedAt: "2027-01-15T08:00:00.000Z",
    });
  });

  it("returns null when no measurable weather values exist", () => {
    expect(weatherForBulletin({ current: { weather: [] }, forecast5: [] })).toBeNull();
  });
  it("does not display malformed rain probabilities as percentages", () => {
    expect(weatherForBulletin({ current: { main: { temp: 26 } }, forecast5: [{ pop: 1.5 }] })?.rainChancePct).toBeNull();
    expect(weatherForBulletin({ current: { main: { temp: 26 } }, forecast5: [{ pop: -0.1 }] })?.rainChancePct).toBeNull();
  });
});
