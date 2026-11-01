// Gemma 4 look at one field photo before upload: crop stage and every likely disease, pest or
// nutrient condition (not only the three classes of the browser classifier). Advisory only:
// the pinned BLB and Brown Spot models still decide what is measured and published.

export const CROP_STAGES = ["seedling", "vegetative", "reproductive", "ripening", "post_harvest", "unknown"] as const;
export type CropStage = (typeof CROP_STAGES)[number];

/** Conditions Gemma may name, so answers stay comparable across photos and surveys. */
export const RICE_CONDITIONS = [
  "Healthy", "Bacterial leaf blight", "Bacterial leaf streak", "Brown spot", "Leaf blast", "Neck blast",
  "Sheath blight", "Sheath rot", "Narrow brown leaf spot", "Leaf scald", "False smut", "Stem rot", "Tungro",
  "Grassy or ragged stunt", "Stem borer damage", "Planthopper or hopperburn", "Leaf folder damage", "Rice hispa damage",
  "Rice bug damage", "Rat damage", "Golden apple snail damage", "Nitrogen deficiency", "Potassium deficiency",
  "Zinc deficiency", "Iron toxicity", "Drought stress", "Flood or submergence", "Lodging", "Weeds", "Dry or senescent leaves",
] as const;

export interface PhotoInsight {
  model: string;
  is_rice_field: boolean;
  crop_stage: CropStage;
  stage_confidence: number;
  conditions: Array<{ name: string; confidence: number }>;
  quality: "good" | "blurry" | "too_far" | "too_dark" | "not_rice";
  summary: string;
  seconds: number;
}

const clamp01 = (value: unknown) => Math.max(0, Math.min(1, Number(value) || 0));
const SYSTEM = `You are a rice crop specialist in the Philippines looking at one field photo (drone or phone).
Answer ONLY as JSON:
{"is_rice_field": boolean,
 "crop_stage": one of ${JSON.stringify(CROP_STAGES)},
 "stage_confidence": 0-1,
 "conditions": [{"name": one of ${JSON.stringify(RICE_CONDITIONS)}, "confidence": 0-1}],
 "quality": "good" | "blurry" | "too_far" | "too_dark" | "not_rice",
 "summary": one or two short sentences in Taglish (Tagalog with simple English terms) for a farmer}
List at most 4 conditions, most likely first; confidences are your own estimate and need not sum to 1.
Name only what is visible. Yellowing alone can be nitrogen deficiency or dry leaves, not a disease.
If unsure of the stage use "unknown". Do not recommend chemicals.`;

export async function photoInsight(input: { base: string; key: string; model: string; image: string; detail?: string }): Promise<PhotoInsight> {
  const started = Date.now();
  const response = await fetch(`${input.base}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.key}` },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: input.model, stream: false, format: "json", think: false,
      options: { temperature: 0.1, num_predict: 500 },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: input.detail ? "Suriin ang palayan. Unang larawan: buong kuha. Pangalawa: close-up sa gitna para makita ang dahon." : "Suriin ang larawang ito ng palayan.", images: [input.image, ...(input.detail ? [input.detail] : [])] }],
    }),
  });
  if (!response.ok) throw new Error(`Gemma photo check returned ${response.status}`);
  const payload = await response.json();
  const text = String(payload?.message?.content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const raw = JSON.parse(text.slice(Math.max(0, text.indexOf("{")), text.lastIndexOf("}") + 1)) as Record<string, unknown>;
  const known = new Map(RICE_CONDITIONS.map((name) => [name.toLowerCase(), name]));
  const conditions = (Array.isArray(raw.conditions) ? raw.conditions : [])
    .map((item) => item as Record<string, unknown>)
    .map((item) => ({ name: known.get(String(item.name || "").toLowerCase().trim()), confidence: clamp01(item.confidence) }))
    .filter((item): item is { name: (typeof RICE_CONDITIONS)[number]; confidence: number } => Boolean(item.name))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4)
    .map((item) => ({ name: item.name, confidence: Math.round(item.confidence * 100) / 100 }));
  const stage = CROP_STAGES.includes(raw.crop_stage as CropStage) ? raw.crop_stage as CropStage : "unknown";
  const quality = ["good", "blurry", "too_far", "too_dark", "not_rice"].includes(String(raw.quality)) ? raw.quality as PhotoInsight["quality"] : "good";
  return {
    model: input.model, is_rice_field: raw.is_rice_field !== false, crop_stage: stage,
    stage_confidence: Math.round(clamp01(raw.stage_confidence) * 100) / 100, conditions, quality,
    summary: String(raw.summary || "").replace(/\s+/g, " ").trim().slice(0, 400),
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

/** Validate a stored insight sent back by the browser with the upload (the server produced it). */
export function storedInsight(value: unknown): PhotoInsight | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!CROP_STAGES.includes(v.crop_stage as CropStage) || !Array.isArray(v.conditions)) return null;
  return {
    model: String(v.model || "").slice(0, 80), is_rice_field: v.is_rice_field !== false, crop_stage: v.crop_stage as CropStage,
    stage_confidence: clamp01(v.stage_confidence),
    conditions: (v.conditions as Array<Record<string, unknown>>).slice(0, 4)
      .filter((c) => RICE_CONDITIONS.includes(c.name as (typeof RICE_CONDITIONS)[number]))
      .map((c) => ({ name: String(c.name), confidence: clamp01(c.confidence) })),
    quality: ["good", "blurry", "too_far", "too_dark", "not_rice"].includes(String(v.quality)) ? v.quality as PhotoInsight["quality"] : "good",
    summary: String(v.summary || "").slice(0, 400), seconds: Number(v.seconds) || 0,
  };
}
