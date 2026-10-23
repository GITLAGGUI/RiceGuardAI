import { describe, expect, it } from "vitest";
import { validatedSeveritySuggestions } from "../../../supabase/functions/_shared/severityRecommendation";
import { validateFieldSeverity } from "../../../supabase/functions/_shared/fieldSeverity";
describe("suggestions never silently become approved severity", () => {
  const recommendation = [{ disease: "BLB", category: "moderate", reason: "Visible blighted portions across several sampled leaves." }];
  it("refuses a grade without an actual image, including text-only provider fallback", () => {
    expect(validatedSeveritySuggestions(recommendation, ["BLB"], false)[0].category).toBe("unknown");
  });
  it("retains separate disease suggestions and abstains for missing or duplicate evidence", () => {
    expect(validatedSeveritySuggestions(recommendation, ["BLB", "Brown Spot"], true).map(row => row.category)).toEqual(["moderate", "unknown"]);
    expect(validatedSeveritySuggestions([...recommendation, ...recommendation], ["BLB"], true)[0].category).toBe("unknown");
    expect(validatedSeveritySuggestions([{ ...recommendation[0], category: "calibrated" }], ["BLB"], true)[0].category).toBe("unknown");
  });
  const reviewed = { disease: "BLB", category: "moderate", specialist: "Field reviewer", notes: "I reviewed the visible leaf damage in the original sample.", basis: "reviewed_visual_estimate", confirmed: true, advisory_revision: 3 };
  it("requires an explicit reviewer confirmation and current revision for qualitative approval", () => {
    expect(validateFieldSeverity(reviewed)).toMatchObject({ model_calibrated: false, scope: "reviewed_media_not_whole_field", category: "moderate" });
    expect(() => validateFieldSeverity({ ...reviewed, confirmed: false })).toThrow(/Confirm/);
    expect(() => validateFieldSeverity({ ...reviewed, advisory_revision: undefined })).toThrow(/revision/);
    expect(() => validateFieldSeverity({ ...reviewed, category: "unknown" })).toThrow(/category/);
  });
  it("never substitutes visual approval for measured lesion evidence", () => {
    expect(() => validateFieldSeverity({ ...reviewed, basis: "manual_field_assessment" })).toThrow(/measured/);
    expect(validateFieldSeverity({ ...reviewed, basis: "manual_field_assessment", leaf_area_affected_pct: 12.5, sampled_leaves: 20 })).toMatchObject({ basis: "manual_field_assessment", model_calibrated: false });
  });
  it("rejects an unrecognized assessment basis instead of silently changing it", () => {
    expect(() => validateFieldSeverity({ ...reviewed, basis: "auto_calibrated", leaf_area_affected_pct: 12, sampled_leaves: 20 })).toThrow(/basis/);
  });
});
