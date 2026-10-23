import { describe, expect, it } from "vitest";
import { reviewedDiseaseLabel, smsAdvisoryMessage } from "../../../supabase/functions/_shared/advisoryPresentation";

describe("reviewed advisory presentation", () => {
  it("presents both accepted diseases regardless of stored order", () => {
    expect(reviewedDiseaseLabel({ disease: "BLB", diseases: ["Brown Spot", "BLB"] })).toBe("BLB and Brown Spot");
  });

  it("retains a historical single-disease bulletin", () => {
    expect(reviewedDiseaseLabel({ disease: "Brown Spot" })).toBe("Brown Spot");
  });

  it("never sends a private field location", () => {
    const bulletin = { disease: "BLB", diseases: ["BLB", "Brown Spot"], action: "Consult an extension worker.", slug: "field-a", location: "Exact Farm Gate 17" };
    const message = smsAdvisoryMessage(
      bulletin,
      "https://riceguardai.dev/advisories/field-a",
      true,
    );
    expect(message).toContain("BLB and Brown Spot");
    expect(message).toContain("Consult an extension worker.");
    expect(message).not.toContain("Exact Farm Gate 17");
  });

  it("keeps the public link and opt-out instruction when action text is long", () => {
    const message = smsAdvisoryMessage(
      { disease: "BLB", action: "Check the field. ".repeat(100), slug: "field-a" },
      "https://riceguardai.dev/advisories/field-a",
      true,
    );
    expect(message.length).toBeLessThanOrEqual(620);
    expect(message).toContain("https://riceguardai.dev/advisories/field-a");
    expect(message).toContain("Reply STOP to opt out.");
  });
});
