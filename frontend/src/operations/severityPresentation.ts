import type { Bulletin, Severity, Survey } from "./domain";
const grades: Severity[] = ["low", "moderate", "high"];
export function currentSeverityBulletin(survey: Survey, bulletins: Bulletin[]) {
  const revision = survey.active_result_revision ?? survey.approved_result_revision;
  if (!revision) return undefined;
  return bulletins.filter(b => b.survey_id === survey.id && b.result_revision === revision)
    .sort((a, b) => (b.advisory_revision ?? 0) - (a.advisory_revision ?? 0))[0];
}
export function fieldSeverityForSurvey(survey: Survey, bulletins: Bulletin[]): Severity {
  const revision = survey.active_result_revision ?? survey.approved_result_revision;
  if (!revision || survey.approved_result_revision !== revision || survey.status !== "Reviewed") return "not_calibrated";
  const bulletin = currentSeverityBulletin(survey, bulletins);
  if (survey.field_assessment) {
    const assessment = survey.field_assessment;
    const diseases = bulletin?.diseases?.length ? bulletin.diseases : bulletin?.disease ? [bulletin.disease] : [];
    if (assessment.result_revision !== revision || !diseases.length || diseases.some(d =>
      !grades.includes(assessment.diseases[d]?.category as Severity))) return "not_calibrated";
    return diseases.reduce<Severity>((highest, d) => grades.indexOf(assessment.diseases[d].category as Severity) > grades.indexOf(highest)
      ? assessment.diseases[d].category as Severity : highest, "low");
  }
  // Preserve previously approved qualitative field categories; they are not
  // silently turned into calibrated model measurements.
  const reviewed = bulletin?.status === "published" && bulletin.reviewer && grades.includes(bulletin.severity) ? bulletin : null;
  return reviewed?.severity || "not_calibrated";
}
export function currentSeveritySuggestion(survey: Survey, bulletin: Bulletin | undefined, disease: string) {
  const suggestion = bulletin?.severity_recommendation;
  if (!suggestion || suggestion.result_revision !== survey.active_result_revision ||
      suggestion.advisory_revision !== bulletin?.advisory_revision || suggestion.model_calibrated !== false ||
      !Number.isInteger(suggestion.image_count) || suggestion.image_count < 1 ||
      !bulletin?.diseases?.includes(disease as Bulletin["disease"])) return null;
  const matches = suggestion.diseases.filter(row => row.disease === disease);
  return matches.length === 1 ? matches[0] : null;
}
export function fieldSeverityLabel(value: Severity) {
  return value === "low" ? "Low" : value === "moderate" ? "Moderate" : value === "high" ? "Severe" : "Not assessed";
}
