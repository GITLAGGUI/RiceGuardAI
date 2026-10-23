export type SuggestedCategory = "low" | "moderate" | "high" | "unknown";
export interface SeveritySuggestion {
  disease: "BLB" | "Brown Spot";
  category: SuggestedCategory;
  reason: string;
}
export const severitySuggestionSchema = { type: "array", items: { type: "object", additionalProperties: false,
  required: ["disease", "category", "reason"], properties: {
    disease: { type: "string", enum: ["BLB", "Brown Spot"] },
    category: { type: "string", enum: ["low", "moderate", "high", "unknown"] }, reason: { type: "string" },
  } } };
export const severitySuggestionInstruction = "Separately return severity_recommendations for each accepted disease. These are qualitative visual suggestions ONLY, never calibrated lesion percentages, diagnoses or whole-field severity. Assess only the attached original review image: low=limited visible damage with mostly intact leaf tissue; moderate=noticeable damage across several visible leaves; high=extensive visible damage/blighting across the visible sample. These are provisional RiceGuardAI review categories, NOT IRRI quantitative thresholds. Do not use whole-leaf mask coverage, detection confidence, predicted pixel counts, weather or standing water to assign disease severity. Explain specific visible evidence and limited image scope. Use unknown when no image is attached, disease damage cannot be distinguished, detail is insufficient, or the visible sample does not support a grade. Never assume no detected lesion means healthy. Admin must approve or override separately.";
export function validatedSeveritySuggestions(value: unknown, diseases: string[], hasImages: boolean): SeveritySuggestion[] {
  return diseases.filter((d): d is SeveritySuggestion["disease"] => d === "BLB" || d === "Brown Spot").map(disease => {
    const matches = Array.isArray(value) ? value.filter(row => row && row.disease === disease) : [];
    const row = matches.length === 1 ? matches[0] : null;
    if (!hasImages || !row || !["low", "moderate", "high", "unknown"].includes(row.category) ||
      typeof row.reason !== "string" || row.reason.trim().length < 10 || row.reason.length > 1000)
      return { disease, category: "unknown", reason: "Insufficient usable visual evidence. Review the original media or record a measured field assessment." };
    return { disease, category: row.category, reason: row.reason.trim() };
  });
}
