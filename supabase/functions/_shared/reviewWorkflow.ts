import { validateFieldSeverity } from "./fieldSeverity.ts";

export type ReviewStep = "images" | "severity" | "location" | "publish";
export type Readiness = {
  bulletin_id: string; survey_id: string; advisory_revision: number;
  published: boolean; ready: boolean; evidence_key: string;
  steps: { step: ReviewStep; complete: boolean; reason: string }[];
  public_path: string; map_eligible: boolean;
};
export function validateSeverityReview(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) throw new Error("Review every accepted disease together.");
  const seen = new Set<string>();
  return value.map(row => {
    if (!row || !["BLB", "Brown Spot"].includes(row.disease) || seen.has(row.disease)) throw new Error("Each accepted disease must appear exactly once.");
    seen.add(row.disease);
    if (row.confirmed !== true) throw new Error(`Confirm your ${row.disease} review.`);
    if (row.basis !== "not_assessed") return { ...validateFieldSeverity(row), confirmed: true };
    if (row.category !== "not_assessed") throw new Error("Not assessed must not contain a damage grade.");
    if (typeof row.specialist !== "string" || row.specialist.trim().length < 2 || row.specialist.length > 120) throw new Error("Record the approving reviewer name.");
    if (typeof row.notes !== "string" || row.notes.trim().length < 20 || row.notes.length > 2000) throw new Error("Explain why severity could not be assessed (at least 20 characters).");
    return { disease: row.disease, category: "not_assessed", basis: "not_assessed", confirmed: true,
      model_calibrated: false, specialist: row.specialist.trim(), notes: row.notes.trim(), scope: "not_assessed" };
  });
}
export function validReviewCoordinates(lat: unknown, lng: unknown) {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}
