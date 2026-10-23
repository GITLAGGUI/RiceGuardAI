import { describe, expect, it } from "vitest";
import { processingSignature } from "./processingStatus";
import { validateFieldSeverity } from "../../../supabase/functions/_shared/fieldSeverity";
describe("automatic processing updates", () => {
  const row = { id: "a", status: "Queued", progress: 0 };
  it("is stable across ordering and new object references", () => {
    expect(processingSignature({ surveys: [row, { ...row, id: "b" }], jobs: [] })).toBe(processingSignature({ surveys: [{ ...row, id: "b" }, { ...row }], jobs: [] }));
  });
  it("detects completion and evidence revision changes", () => {
    const before = processingSignature({ surveys: [row], jobs: [] });
    expect(processingSignature({ surveys: [{ ...row, status: "Needs review", progress: 100 }], jobs: [] })).not.toBe(before);
    expect(processingSignature({ surveys: [{ ...row, active_result_revision: 2 }], jobs: [] })).not.toBe(before);
  });
});
describe("field severity is evidence, not fabricated AI calibration", () => {
  const evidence = { disease: "Brown Spot", category: "moderate", leaf_area_affected_pct: 12, sampled_leaves: 30, specialist: "Field assessor", notes: "Sampled upper and lower leaves across five independent field locations." };
  it("records lesion measurements without treating whole affected leaves as lesions", () => {
    expect(validateFieldSeverity(evidence)).toMatchObject({ basis: "manual_field_assessment", model_calibrated: false, scope: "sampled_leaves_not_whole_field" });
  });
  it.each([-1, 101, NaN, Infinity, "12", null])("rejects invalid percentages %s", value => expect(() => validateFieldSeverity({ ...evidence, leaf_area_affected_pct: value })).toThrow());
  it.each([0, 0.5, 10001, "30"])("rejects invalid counts %s", value => expect(() => validateFieldSeverity({ ...evidence, sampled_leaves: value })).toThrow());
  it("requires assessor and scoring rationale", () => {
    expect(() => validateFieldSeverity({ ...evidence, notes: "test" })).toThrow();
    expect(() => validateFieldSeverity({ ...evidence, specialist: "" })).toThrow();
    expect(() => validateFieldSeverity({ ...evidence, category: "healthy" })).toThrow();
  });
});
