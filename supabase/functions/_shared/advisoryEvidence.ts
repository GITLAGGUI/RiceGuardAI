export const DISEASES = ["BLB", "Brown Spot"] as const;
export type DiseaseName = typeof DISEASES[number];

export interface AdvisorySource {
  id: string;
  disease: DiseaseName;
  title: string;
  version: string;
  reference: string;
  guidance: unknown;
}

export interface AdvisoryDraft {
  summary: string;
  recommended_actions: string[];
  limitations: string[];
  source_ids: string[];
}

export const FIELD_CONDITIONS = [
  "standing_water",
  "lodging",
  "dry_or_cracked_soil",
  "nutrient_stress_suspected",
  "pest_damage_suspected",
] as const;
export type FieldCondition = typeof FIELD_CONDITIONS[number];
export type FieldContext = {
  crop_stage?: string | null;
  field_conditions?: unknown;
};
const CONDITION_LABELS: Record<FieldCondition, string> = {
  standing_water: "standing water or possible flooding",
  lodging: "lodged or flattened plants",
  dry_or_cracked_soil: "dry or cracked soil",
  nutrient_stress_suspected: "possible nutrient stress",
  pest_damage_suspected: "possible pest or animal damage",
};

type BulletinScope = { disease: string; diseases?: unknown };
type Revision = {
  manifest: unknown;
  blb_coverage?: number | null;
  brown_spot_affected_leaf_coverage?: number | null;
  severity_status?: string;
  severity_label?: string;
  warnings?: unknown;
};

export function reviewedDiseaseScope(bulletin: BulletinScope, revision: Revision): DiseaseName[] {
  const manifest = revision.manifest as Record<string, unknown> | null;
  const v2 = manifest?.schema_version === "riceguard.result.v2";
  if (v2 && !Array.isArray(bulletin.diseases))
    throw new Error("Reviewed multi-disease decisions are missing");
  const raw = v2 ? bulletin.diseases as unknown[] : [bulletin.disease];
  if (!Array.isArray(raw) || raw.some((name) => !DISEASES.includes(name as DiseaseName)))
    throw new Error("Unsupported disease in reviewed advisory");
  const diseases = DISEASES.filter((name) => raw.includes(name));
  if (!diseases.length) throw new Error("No accepted disease finding for advisory");
  if (v2) {
    const assets = manifest?.assets;
    if (!Array.isArray(assets) || !assets.length) throw new Error("Reviewed result has no assets");
    for (const disease of diseases) {
      const detected = assets.some((asset) => {
        const findings = (asset as { diseases?: unknown }).diseases;
        return Array.isArray(findings) && findings.some((finding) =>
          (finding as { disease?: unknown; status?: unknown }).disease === disease &&
          (finding as { status?: unknown }).status === "detected");
      });
      if (!detected) throw new Error(`Accepted ${disease} finding is absent from the immutable result`);
    }
  }
  return diseases;
}

export function approvedGuidanceForDiseases(sources: AdvisorySource[], diseases: DiseaseName[]): AdvisorySource[] {
  const selected = sources.filter((source) => diseases.includes(source.disease));
  for (const disease of diseases) {
    if (!selected.some((source) => source.disease === disease))
      throw new Error(`Approved agricultural guidance is missing for ${disease}`);
  }
  return selected;
}

/** Conditional sources are included only when the reviewed field context calls for them. */
export function guidanceForFieldContext(
  sources: AdvisorySource[], diseases: DiseaseName[], context?: FieldContext,
): AdvisorySource[] {
  const conditions = new Set(Array.isArray(context?.field_conditions)
    ? context.field_conditions.filter((item): item is FieldCondition => FIELD_CONDITIONS.includes(item as FieldCondition))
    : []);
  const selected = sources.filter((source) => {
    if (!diseases.includes(source.disease)) return false;
    const appliesWhen = (source.guidance as Record<string, unknown> | null)?.applies_when;
    return !Array.isArray(appliesWhen) || !appliesWhen.length || appliesWhen.some((item) => conditions.has(item as FieldCondition));
  });
  return approvedGuidanceForDiseases(selected, diseases);
}

export function publishGuidanceIsComplete(
  diseases: unknown,
  sourceIds: unknown,
  activeSources: Array<{ id: string; disease: string }>,
): boolean {
  if (!Array.isArray(diseases) || !diseases.length ||
    diseases.some((disease) => !DISEASES.includes(disease)) ||
    !Array.isArray(sourceIds) || !sourceIds.length ||
    sourceIds.some((id) => typeof id !== "string" || !activeSources.some((source) => source.id === id)))
    return false;
  return diseases.every((disease) =>
    activeSources.some((source) => sourceIds.includes(source.id) && source.disease === disease));
}

export function draftFromApprovedGuidance(
  sources: AdvisorySource[], diseases: DiseaseName[], weatherInput: boolean | Record<string, unknown> | null, context?: FieldContext,
) {
  const approved = guidanceForFieldContext(sources, diseases, context);
  const selected = approved.filter((source) => diseases.includes(source.disease));
  const primary = diseases.map((disease) => selected.find((source) =>
    source.disease === disease && !Array.isArray((source.guidance as Record<string, unknown>)?.applies_when)) ||
    selected.find((source) => source.disease === disease)!);
  const conditions = Array.isArray(context?.field_conditions)
    ? context.field_conditions.filter((item): item is FieldCondition => FIELD_CONDITIONS.includes(item as FieldCondition))
    : [];
  const cropStage = typeof context?.crop_stage === "string" && context.crop_stage !== "unknown" ? context.crop_stage : null;
  const fieldSummary = conditions.length
    ? ` Field review recorded ${conditions.map((item) => CONDITION_LABELS[item]).join(", ")}${cropStage ? ` during the ${cropStage.replaceAll("_", " ")} stage` : ""}; extent and cause still require on-site confirmation.`
    : cropStage ? ` The recorded crop stage is ${cropStage.replaceAll("_", " ")}.` : "";
  const contextActions = conditions.flatMap((condition) => {
    if (condition === "standing_water") return [];
    if (condition === "lodging") return ["Verify the cause and affected area of the recorded lodging before planning harvest, drainage, or crop-recovery work."];
    if (condition === "dry_or_cracked_soil") return ["Check actual soil moisture and irrigation availability on site before changing water management."];
    if (condition === "nutrient_stress_suspected") return ["Treat the recorded nutrient concern as unconfirmed until field symptoms and a suitable soil or plant diagnostic are reviewed."];
    return ["Inspect the recorded pest or animal damage separately; the BLB and Brown Spot masks do not identify its cause."];
  });
  const weather = typeof weatherInput === "object" && weatherInput ? weatherInput : null;
  const observation = weather?.observation as Record<string, unknown> | null | undefined;
  const forecast = Array.isArray(weather?.forecast_3hour_intervals) ? weather.forecast_3hour_intervals as Array<Record<string, unknown>> : [];
  const weatherParts = [
    typeof observation?.temperature_c === "number" ? `${observation.temperature_c}°C` : null,
    typeof observation?.humidity_pct === "number" ? `${observation.humidity_pct}% humidity` : null,
    typeof observation?.rain_1h_mm === "number" ? `${observation.rain_1h_mm} mm rain in the last hour` : null,
  ].filter(Boolean);
  const weatherSummary = weatherParts.length ? ` Nearby weather observed ${weatherParts.join(", ")}; this is context only, not proof of field conditions or disease cause.` : "";
  const maxRainProbability = Math.max(-1, ...forecast.map((step) => typeof step.precipitation_probability === "number" ? step.precipitation_probability : -1));
  const weatherActions = maxRainProbability >= 0.6
    ? ["Rain is likely in the nearby forecast; plan the next field inspection and drone capture only when access and flight conditions are safe."]
    : [];
  return {
    summary: primary.map((source) => `${source.disease}: ${String((source.guidance as Record<string, unknown>)?.summary || "Model findings require field verification.")}`).join("\n") + fieldSummary + weatherSummary,
    recommended_actions: [...new Set(selected.flatMap((source) => {
      const actions = (source.guidance as Record<string, unknown>)?.recommended_actions;
      return Array.isArray(actions) ? actions.map(String) : [];
    }).concat(contextActions, weatherActions))],
    limitations: [...new Set(selected.flatMap((source) => {
      const limitations = (source.guidance as Record<string, unknown>)?.limitations;
      return Array.isArray(limitations) ? limitations.map(String) : [];
    })), "Visual model output does not independently confirm a diagnosis or field-wide severity.",
    ...(weatherInput ? ["Nearby weather is contextual and does not establish disease cause or field-level risk."] : [])],
    source_ids: selected.map((source) => source.id),
  };
}

export function validateAdvisoryDraft(raw: unknown, sources: AdvisorySource[], diseases: DiseaseName[]): AdvisoryDraft {
  if (!raw || typeof raw !== "object") throw new Error("Advisory provider returned no structured draft");
  const draft = raw as Record<string, unknown>;
  if (typeof draft.summary !== "string" || !draft.summary.trim() || draft.summary.length > 3000 ||
    !Array.isArray(draft.recommended_actions) || !draft.recommended_actions.length || draft.recommended_actions.length > 8 ||
    draft.recommended_actions.some((action) => typeof action !== "string" || !action.trim() || action.length > 600) ||
    !Array.isArray(draft.limitations) || draft.limitations.length > 8 ||
    draft.limitations.some((item) => typeof item !== "string" || item.length > 600) ||
    !Array.isArray(draft.source_ids))
    throw new Error("Advisory provider returned an invalid structured draft");
  const approvedIds = new Set(sources.map((source) => source.id));
  if (draft.source_ids.some((id) => typeof id !== "string" || !approvedIds.has(id)))
    throw new Error("Advisory draft cited an unapproved source");
  const sourceIds = [...new Set(draft.source_ids as string[])];
  const missingDisease = diseases.find((disease) => !sources.some((source) => source.disease === disease && sourceIds.includes(source.id)));
  if (missingDisease) throw new Error(`Advisory draft omitted an approved source for ${missingDisease}`);
  return {
    summary: draft.summary.trim(),
    recommended_actions: (draft.recommended_actions as string[]).map((action) => action.trim()),
    limitations: (draft.limitations as string[]).map((item) => item.trim()),
    source_ids: sourceIds,
  };
}

export function advisoryFacts(
  bulletin: BulletinScope & { location: string; result_revision: number }, revision: Revision, context?: FieldContext,
) {
  const diseases = reviewedDiseaseScope(bulletin, revision);
  const manifest = revision.manifest as Record<string, unknown> | null;
  const v2 = manifest?.schema_version === "riceguard.result.v2";
  // The location field is free text and can contain an exact address. The LLM
  // receives a broad region only; precise coordinates stay in the private DB.
  const approximateLocation = "Region II, Philippines (field location not independently verified)";
  const conditions = Array.isArray(context?.field_conditions)
    ? context.field_conditions.filter((item): item is FieldCondition => FIELD_CONDITIONS.includes(item as FieldCondition))
    : [];
  const fieldContext = {
    crop_stage: typeof context?.crop_stage === "string" && context.crop_stage ? context.crop_stage : "unknown",
    reviewed_conditions: conditions,
    interpretation: conditions.length
      ? "Operator-reviewed field observations; not inferred by the BLB or Brown Spot models"
      : "No additional field condition was recorded; do not infer flooding, nutrient deficiency, crop stage, or pests from disease masks",
  };
  if (v2) {
    const assets = manifest.assets as Array<{ diseases?: Array<{ disease?: string; status?: string; mask_meaning?: string }> }>;
    return {
      diseases,
      approximate_location: approximateLocation,
      field_context: fieldContext,
      result_revision: bulletin.result_revision,
      result_type: "reviewed_two_specialist_semantic_masks",
      per_image_findings: assets.map((asset, index) => ({
        image_index: index + 1,
        findings: (asset.diseases || []).filter((finding) => diseases.includes(finding.disease as DiseaseName))
          .map((finding) => ({ disease: finding.disease, status: finding.status, mask_meaning: finding.mask_meaning })),
      })),
      severity: "Not estimable from the current whole-leaf and disease-region masks",
      quality_warning_count: Array.isArray(revision.warnings) ? revision.warnings.length : 0,
    };
  }
  return {
    diseases,
    approximate_location: approximateLocation,
    field_context: fieldContext,
    result_revision: bulletin.result_revision,
    result_type: "legacy_reviewed_semantic_result",
    measurements: {
      blb_disease_region_coverage: diseases.includes("BLB") ? revision.blb_coverage ?? null : null,
      brown_spot_affected_leaf_coverage: diseases.includes("Brown Spot") ? revision.brown_spot_affected_leaf_coverage ?? null : null,
    },
    severity: revision.severity_status === "calibrated" ? revision.severity_label : "Severity not calibrated",
    quality_warning_count: Array.isArray(revision.warnings) ? revision.warnings.length : 0,
  };
}
