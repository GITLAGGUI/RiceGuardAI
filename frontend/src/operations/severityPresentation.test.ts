import { describe, expect, it } from "vitest";
import { currentSeverityBulletin, currentSeveritySuggestion, fieldSeverityForSurvey, fieldSeverityLabel } from "./severityPresentation";
import type { Bulletin, Survey } from "./domain";
describe("reviewed field categories stay consistent without inventing AI calibration", () => {
  const survey = { id: "survey", severity: "not_calibrated", status: "Reviewed", active_result_revision: 1, approved_result_revision: 1 } as Survey;
  const bulletin = { survey_id: "survey", severity: "moderate", result_revision: 1, status: "published", reviewer: "Reviewer", diseases: ["BLB", "Brown Spot"], advisory_revision: 2 } as Bulletin;
  it("preserves an approved qualitative category across the admin map and review", () => expect(fieldSeverityForSurvey(survey, [bulletin])).toBe("moderate"));
  it("ignores grades from another result revision or survey", () => {
    expect(fieldSeverityForSurvey(survey, [{ ...bulletin, result_revision: 2 }])).toBe("not_calibrated");
    expect(fieldSeverityForSurvey(survey, [{ ...bulletin, survey_id: "other" }])).toBe("not_calibrated");
  });
  it("never replaces an incomplete current field assessment with a legacy label", () => {
    const field_assessment = { basis: "manual_field_assessment", model_calibrated: false, result_revision: 1, diseases: {} } as const;
    expect(fieldSeverityForSurvey({ ...survey, field_assessment }, [bulletin])).toBe("not_calibrated");
  });
  it("uses farmer-facing names", () => {
    expect(fieldSeverityLabel("high")).toBe("Severe");
    expect(fieldSeverityLabel("not_calibrated")).toBe("Not assessed");
  });
  it("never carries an old grade onto an unapproved new result", () => {
    expect(fieldSeverityForSurvey({ ...survey, active_result_revision: 2, severity: "high" }, [bulletin])).toBe("not_calibrated");
    expect(fieldSeverityForSurvey({ ...survey, status: "Needs review", severity: "high" }, [bulletin])).toBe("not_calibrated");
  });
  it("does not treat an unapproved advisory draft as reviewed severity", () => {
    expect(fieldSeverityForSurvey(survey, [{ ...bulletin, status: "draft", reviewer: null }])).toBe("not_calibrated");
    expect(fieldSeverityForSurvey({ ...survey, severity: "high" }, [{ ...bulletin, status: "draft", reviewer: null }])).toBe("not_calibrated");
  });
  const row = { category: "high", specialist: "Reviewer", notes: "Visible damage reviewed in original media." };
  it("uses the highest CURRENT disease approval only after both are assessed", () => {
    const field_assessment = { basis: "reviewed_severity_assessment", model_calibrated: false, result_revision: 1, diseases: { BLB: { ...row, category: "low" }, "Brown Spot": row } } as const;
    expect(fieldSeverityForSurvey({ ...survey, field_assessment }, [bulletin])).toBe("high");
    expect(fieldSeverityForSurvey({ ...survey, field_assessment: { ...field_assessment, diseases: { BLB: row } } }, [bulletin])).toBe("not_calibrated");
    expect(fieldSeverityForSurvey({ ...survey, field_assessment: { ...field_assessment, result_revision: 2 } }, [bulletin])).toBe("not_calibrated");
  });
  it("ignores a rejected disease even if an older saved grade is high", () => {
    const field_assessment = { basis: "reviewed_severity_assessment", model_calibrated: false, result_revision: 1, diseases: { BLB: { ...row, category: "low" }, "Brown Spot": row } } as const;
    expect(fieldSeverityForSurvey({ ...survey, field_assessment }, [{ ...bulletin, diseases: ["BLB"] }])).toBe("low");
  });
  it("selects the latest advisory for the active result, not array order", () => {
    expect(currentSeverityBulletin(survey, [{ ...bulletin, advisory_revision: 1 }, bulletin])?.advisory_revision).toBe(2);
  });
  const suggested = { ...bulletin, severity_recommendation: { basis: "ai_visual_suggestion", model_calibrated: false, scope: "attached_review_image_not_whole_field", result_revision: 1, advisory_revision: 2, image_count: 1, diseases: [{ disease: "BLB", category: "moderate", reason: "Visible sample damage only." }] } } as Bulletin;
  it("accepts only an image-based suggestion bound to the current advisory/result", () => {
    expect(currentSeveritySuggestion(survey, suggested, "BLB")?.category).toBe("moderate");
    expect(currentSeveritySuggestion(survey, { ...suggested, advisory_revision: 3 }, "BLB")).toBeNull();
    expect(currentSeveritySuggestion({ ...survey, active_result_revision: 2 }, suggested, "BLB")).toBeNull();
    expect(currentSeveritySuggestion(survey, { ...suggested, diseases: ["Brown Spot"] }, "BLB")).toBeNull();
    expect(currentSeveritySuggestion(survey, { ...suggested, severity_recommendation: { ...suggested.severity_recommendation!, image_count: 0 } }, "BLB")).toBeNull();
  });
});
