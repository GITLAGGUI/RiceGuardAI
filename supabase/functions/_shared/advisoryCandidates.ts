import type { AdvisorySource, DiseaseName } from "./advisoryEvidence.ts";

export type AdvisoryCandidate = Omit<AdvisorySource, "id"> & { id: string; publisher: string };

// Candidate guidance is never active by virtue of existing in code. An AAL2
// administrator must record the agricultural specialist's review before it is
// copied into rg_advisory_sources for use by an advisory draft.
export const ADVISORY_CANDIDATES: readonly AdvisoryCandidate[] = [
  {
    id: "philrice-blb-field-management-20260929-v1",
    disease: "BLB" as DiseaseName,
    title: "DA-PhilRice bacterial leaf blight field management",
    publisher: "DA-PhilRice Crop Protection Division",
    version: "philrice-blb-field-management-20260929-v1",
    reference: "https://www.philrice.gov.ph/philrice-warns-of-major-rice-pest-threats-in-early-2026/",
    guidance: {
      summary: "The reviewed image finding indicates possible BLB. Confirm characteristic leaf symptoms in the field before management decisions.",
      recommended_actions: [
        "Inspect affected leaves in person and ask a local agricultural specialist to confirm the cause.",
        "If BLB is confirmed, review resistant varieties, transplanting injury, field sanitation, drainage, spacing, and nitrogen use with the specialist; avoid excessive nitrogen.",
      ],
      limitations: ["An image alone cannot confirm BLB, field-wide severity, or the appropriate treatment."],
    },
  },
  {
    id: "philrice-brownspot-rainy-season-20260929-v1",
    disease: "Brown Spot" as DiseaseName,
    title: "DA-PhilRice brown spot monitoring and management",
    publisher: "DA-PhilRice",
    version: "philrice-brownspot-rainy-season-20260929-v1",
    reference: "https://www.philrice.gov.ph/philrice-alerts-rice-farmers-of-increased-pest-threats-during-rainy-season/",
    guidance: {
      summary: "The reviewed image finding indicates possible Brown Spot. Confirm leaf symptoms and consider other causes of brown discoloration during field inspection.",
      recommended_actions: [
        "Inspect the affected leaves with a local agricultural specialist before treating the field.",
        "If Brown Spot is confirmed, review seed quality, water depth, balanced fertility, and crop-stage-appropriate management with the specialist; do not infer a fertilizer rate from the image.",
      ],
      limitations: ["Brown leaf marks may have other causes; the current mask does not measure lesion-area severity or justify a fungicide recommendation."],
    },
  },
  {
    id: "philrice-nutrient-diagnosis-20260929-v1",
    disease: "Brown Spot" as DiseaseName,
    title: "DA-PhilRice nutrient diagnosis before fertilizer decisions",
    publisher: "DA-PhilRice",
    version: "philrice-nutrient-diagnosis-20260929-v1",
    reference: "https://www.philrice.gov.ph/sa-paglalagay-ng-pataba-siguraduhing-tama-ang-uri-dami-at-panahon-ng-paglalagay/",
    guidance: {
      summary: "Brown leaf symptoms do not by themselves prove nutrient deficiency. Nutrient decisions should use field observations and diagnostic tools.",
      recommended_actions: [
        "Before changing fertilizer, check soil or plant nutrient status using appropriate tools such as soil analysis, MOET, LCC, or Rice Crop Manager with an agricultural specialist.",
        "Use the correct nutrient element, amount, and timing; avoid both deficient and excessive fertilization.",
      ],
      limitations: ["The image model cannot identify a missing nutrient or calculate a fertilizer formulation or rate."],
    },
  },
];

export function advisoryCandidate(id: unknown): AdvisoryCandidate {
  const candidate = ADVISORY_CANDIDATES.find((item) => item.id === id);
  if (!candidate) throw new Error("Unknown advisory guidance candidate");
  return candidate;
}
