import { describe, expect, it } from "vitest";
import { advisoryFacts, approvedGuidanceForDiseases, draftFromApprovedGuidance, guidanceForFieldContext, publishGuidanceIsComplete, reviewedDiseaseScope, validateAdvisoryDraft } from "../../../supabase/functions/_shared/advisoryEvidence";

const finding = (disease: string, status: string) => ({ disease, status, mask_meaning: disease === "BLB" ? "disease_region" : "affected_leaf" });
const revision = {
  manifest: { schema_version: "riceguard.result.v2", assets: [
    { source_asset_id: "photo-1", diseases: [finding("BLB", "detected"), finding("Brown Spot", "detected")] },
  ] },
  blb_coverage: null,
  brown_spot_affected_leaf_coverage: null,
  severity_status: "not_calibrated",
  severity_label: "not_calibrated",
  warnings: [],
};
const bulletin = { disease: "BLB", diseases: ["BLB", "Brown Spot"], location: "Isabela", result_revision: 2 };

describe("reviewed advisory evidence", () => {
  it("retains both independently accepted diseases without field-wide severity", () => {
    expect(reviewedDiseaseScope(bulletin, revision)).toEqual(["BLB", "Brown Spot"]);
    const facts = advisoryFacts(bulletin, revision);
    expect(facts.diseases).toEqual(["BLB", "Brown Spot"]);
    expect(facts.severity).toContain("Not estimable");
    expect(JSON.stringify(facts)).not.toContain("coverage");
  });
  it("does not send an exact address, asset IDs, or raw warnings to an external LLM", () => {
    const privateBulletin = { ...bulletin, location: "Lot 7, exact farm entrance, Isabela" };
    const privateRevision = { ...revision, warnings: ["private-storage/originals/photo.jpg"] };
    const text = JSON.stringify(advisoryFacts(privateBulletin, privateRevision));
    expect(text).not.toContain("Lot 7");
    expect(text).not.toContain("photo-1");
    expect(text).not.toContain("private-storage");
    expect(text).toContain("Region II");
  });
  it("rejects a class that has no detected mask or no accepted decision", () => {
    expect(() => reviewedDiseaseScope({ ...bulletin, diseases: [] }, revision)).toThrow();
    const blbOnly = { ...revision, manifest: { ...revision.manifest, assets: [
      { source_asset_id: "photo-1", diseases: [finding("BLB", "detected"), finding("Brown Spot", "not_detected")] },
    ] } };
    expect(() => reviewedDiseaseScope(bulletin, blbOnly)).toThrow(/Brown Spot/);
  });
  it("requires approved guidance for each disease", () => {
    const blb = { id: "s1", disease: "BLB" as const, title: "BLB", version: "1", reference: "approved", guidance: {} };
    expect(() => approvedGuidanceForDiseases([blb], ["BLB", "Brown Spot"])).toThrow(/Brown Spot/);
    expect(approvedGuidanceForDiseases([blb], ["BLB"])).toEqual([blb]);
  });
  it("blocks publication when any cited source is inactive or a disease lacks guidance", () => {
    const active = [{ id: "blb", disease: "BLB" }, { id: "brown", disease: "Brown Spot" }];
    expect(publishGuidanceIsComplete(["BLB", "Brown Spot"], ["blb", "brown"], active)).toBe(true);
    expect(publishGuidanceIsComplete(["BLB", "Brown Spot"], ["blb"], active)).toBe(false);
    expect(publishGuidanceIsComplete(["BLB"], ["blb", "inactive"], active)).toBe(false);
    expect(publishGuidanceIsComplete(["BLB", "Rice Blast"], ["blb", "brown"], active)).toBe(false);
  });
  it("builds a two-disease template without inventing weather actions", () => {
    const sources = [
      { id: "blb", disease: "BLB" as const, title: "BLB", version: "1", reference: "approved", guidance: { summary: "Inspect BLB", recommended_actions: ["Inspect the leaf"], limitations: [] } },
      { id: "brown", disease: "Brown Spot" as const, title: "Brown Spot", version: "1", reference: "approved", guidance: { summary: "Inspect Brown Spot", recommended_actions: ["Consult a specialist"], limitations: [] } },
    ];
    const draft = draftFromApprovedGuidance(sources, ["BLB", "Brown Spot"], true);
    expect(draft.summary).toContain("BLB:");
    expect(draft.summary).toContain("Brown Spot:");
    expect(draft.source_ids).toEqual(["blb", "brown"]);
    expect(draft.recommended_actions).toHaveLength(2);
    expect(draft.limitations.join(" ")).toContain("Nearby weather is contextual");
  });
  it("adds flood guidance only for a reviewed standing-water condition", () => {
    const sources = [
      { id: "blb", disease: "BLB" as const, title: "BLB", version: "1", reference: "approved", guidance: { summary: "Inspect BLB", recommended_actions: ["Inspect leaves"] } },
      { id: "water", disease: "BLB" as const, title: "Water", version: "2", reference: "approved", guidance: { applies_when: ["standing_water"], summary: "Water context", recommended_actions: ["Verify water depth and duration"] } },
    ];
    expect(guidanceForFieldContext(sources, ["BLB"], { field_conditions: [] }).map((source) => source.id)).toEqual(["blb"]);
    const contextual = guidanceForFieldContext(sources, ["BLB"], { field_conditions: ["standing_water"] });
    expect(contextual.map((source) => source.id)).toEqual(["blb", "water"]);
    const draft = draftFromApprovedGuidance(sources, ["BLB"], false, { crop_stage: "vegetative", field_conditions: ["standing_water"] });
    expect(draft.summary).toContain("standing water");
    expect(draft.recommended_actions).toContain("Verify water depth and duration");
  });
  it("passes only controlled operator-reviewed context to drafting facts", () => {
    const facts = advisoryFacts(bulletin, revision, { crop_stage: "vegetative", field_conditions: ["standing_water", "invented"] });
    expect(facts.field_context.crop_stage).toBe("vegetative");
    expect(facts.field_context.reviewed_conditions).toEqual(["standing_water"]);
    expect(JSON.stringify(facts)).not.toContain("invented");
  });
  it("tailors the safe fallback to crop, field, and nearby forecast context", () => {
    const sources = [{ id: "blb", disease: "BLB" as const, title: "BLB", version: "1", reference: "approved",
      guidance: { summary: "Inspect BLB", recommended_actions: ["Inspect leaves"] } }];
    const weather = { observation: { temperature_c: 25, humidity_pct: 94, rain_1h_mm: 4 },
      forecast_3hour_intervals: [{ precipitation_probability: 0.8 }] };
    const draft = draftFromApprovedGuidance(sources, ["BLB"], weather,
      { crop_stage: "reproductive", field_conditions: ["lodging"] });
    expect(draft.summary).toContain("reproductive");
    expect(draft.summary).toContain("94% humidity");
    expect(draft.recommended_actions.join(" ")).toContain("lodging");
    expect(draft.recommended_actions.join(" ")).toContain("Rain is likely");
  });
  it("keeps a historical single-disease result readable", () => {
    expect(reviewedDiseaseScope({ disease: "BLB" }, { ...revision, manifest: { schema_version: "riceguard.result.v1" } })).toEqual(["BLB"]);
  });
  it("rejects malformed or unapproved provider drafts before a template fallback", () => {
    const sources = [
      { id: "blb", disease: "BLB" as const, title: "BLB", version: "1", reference: "approved", guidance: {} },
      { id: "brown", disease: "Brown Spot" as const, title: "Brown Spot", version: "1", reference: "approved", guidance: {} },
    ];
    const valid = { summary: "Review findings", recommended_actions: ["Consult a specialist"], limitations: [], source_ids: ["blb", "brown"] };
    expect(validateAdvisoryDraft(valid, sources, ["BLB", "Brown Spot"]).source_ids).toEqual(["blb", "brown"]);
    expect(() => validateAdvisoryDraft({ ...valid, source_ids: ["invented"] }, sources, ["BLB", "Brown Spot"])).toThrow(/unapproved/);
    expect(() => validateAdvisoryDraft({ ...valid, source_ids: ["blb"] }, sources, ["BLB", "Brown Spot"])).toThrow(/Brown Spot/);
    expect(() => validateAdvisoryDraft({ ...valid, recommended_actions: [] }, sources, ["BLB", "Brown Spot"])).toThrow(/invalid/);
  });
});
