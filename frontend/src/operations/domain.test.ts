import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  smsSegments,
  distanceMeters,
  eligibleContacts,
  validatePrediction,
  resultDescription,
  isQuietHour,
  type Prediction,
  type Contact,
} from "./domain";
describe("Phone and notification safety", () => {
  it("normalizes Philippine mobile numbers", () => {
    expect(normalizePhone("0917 123 4567")).toBe("+639171234567");
    expect(normalizePhone("639171234567")).toBe("+639171234567");
  });
  it("rejects non-Philippine and malformed phones", () => {
    for (const p of ["123", "+12025550123", "091712345678", "text"])
      expect(() => normalizePhone(p)).toThrow();
  });
  it("counts GSM single and multipart including extension characters", () => {
    expect(smsSegments("A".repeat(160)).segments).toBe(1);
    expect(smsSegments("A".repeat(161)).segments).toBe(2);
    expect(smsSegments("^".repeat(81)).segments).toBe(2);
  });
  it("counts Unicode UTF-16 units including emoji", () => {
    expect(smsSegments("漢".repeat(70)).segments).toBe(1);
    expect(smsSegments("漢".repeat(71)).segments).toBe(2);
    expect(smsSegments("🌱".repeat(36)).segments).toBe(2);
    expect(smsSegments("").segments).toBe(0);
  });
  it("uses Manila quiet hours with inclusive 20 and exclusive 6", () => {
    expect(isQuietHour(new Date("2026-09-06T12:00:00Z"))).toBe(true);
    expect(isQuietHour(new Date("2026-09-05T22:00:00Z"))).toBe(false);
    expect(isQuietHour(new Date("2026-09-05T21:59:00Z"))).toBe(true);
  });
});
describe("Demo recipient matching", () => {
  const point = { lat: 17, lng: 121 };
  const base: Contact = {
    id: "one",
    name: "Sample",
    phone: "09171234567",
    location: "Demo",
    consent: true,
    verified: true,
    farms: [point],
  };
  it("matches registered farms, not a barangay-only residence", () => {
    expect(
      eligibleContacts(
        [base, { ...base, id: "two", phone: "09171234568", farms: [] }],
        point,
      ),
    ).toHaveLength(1);
  });
  it("excludes unverified and opted-out contacts", () => {
    expect(
      eligibleContacts(
        [
          { ...base, consent: false },
          { ...base, verified: false },
        ],
        point,
      ),
    ).toHaveLength(0);
  });
  it("deduplicates recipients by normalized number", () => {
    expect(
      eligibleContacts(
        [base, { ...base, id: "two", phone: "+639171234567" }],
        point,
      ),
    ).toHaveLength(1);
  });
  it("distinguishes 2999m from 3001m", () => {
    const a = { lat: 17 + ((2999 / 6371008.8) * 180) / Math.PI, lng: 121 };
    const b = { lat: 17 + ((3001 / 6371008.8) * 180) / Math.PI, lng: 121 };
    expect(distanceMeters(point, a)).toBeCloseTo(2999, 5);
    expect(eligibleContacts([{ ...base, farms: [a] }], point)).toHaveLength(1);
    expect(eligibleContacts([{ ...base, farms: [b] }], point)).toHaveLength(0);
  });
});
describe("Inference results", () => {
  const valid: Prediction = {
    model_version: "fixture",
    width: 3840,
    height: 2160,
    profile: "test",
    latency_ms: 100,
    tile_count: 8,
    lesions: [
      {
        class: "BLB",
        confidence: 0.7,
        area_px: 50,
        polygon_native_px: [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
      },
    ],
  };
  it("accepts native polygons and both supported classes", () => {
    expect(validatePrediction(valid)).toEqual(valid);
    expect(
      validatePrediction({
        ...valid,
        lesions: [{ ...valid.lesions[0], class: "Brown Spot" }],
      }).lesions,
    ).toHaveLength(1);
  });
  it("rejects unknown classes, malformed masks and invented confidence", () => {
    expect(() =>
      validatePrediction({
        ...valid,
        lesions: [{ ...valid.lesions[0], class: "Tungro" }],
      }),
    ).toThrow();
    expect(() =>
      validatePrediction({
        ...valid,
        lesions: [{ ...valid.lesions[0], confidence: 2 }],
      }),
    ).toThrow();
    expect(() =>
      validatePrediction({
        ...valid,
        lesions: [
          {
            ...valid.lesions[0],
            polygon_native_px: [
              [0, 0],
              [5000, 1],
              [5, 6],
            ],
          },
        ],
      }),
    ).toThrow();
  });
  it("never turns failed or queued inference into a Healthy outcome", () => {
    expect(resultDescription("Failed")).toBe("Failed");
    expect(resultDescription("Queued")).toBe("Queued");
    expect(resultDescription("Reviewed")).toContain("blocked");
    expect(resultDescription("Reviewed", { ...valid, lesions: [] })).toBe(
      "No target disease detected",
    );
  });
});
