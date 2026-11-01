// Gemma 4 photo check, run before upload: the browser sends two small JPEGs (the whole photo and a
// centre close-up) and the server asks Gemma for crop stage and likely conditions. Nothing is stored
// until the photo is uploaded.
import { fieldOperation } from "./fieldOperations";

export type CropStage = "seedling" | "vegetative" | "reproductive" | "ripening" | "post_harvest" | "unknown";
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

export const STAGE_LABEL: Record<CropStage, string> = {
  seedling: "Punla", vegetative: "Nag-uusbong / tillering", reproductive: "Nagbubuntis / heading",
  ripening: "Nahihinog", post_harvest: "Tapos na ang ani", unknown: "Hindi sigurado",
};

async function jpegBase64(bitmap: ImageBitmap, sx: number, sy: number, sw: number, sh: number, side: number) {
  const scale = side / Math.max(sw, sh);
  const canvas = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32_768) binary += String.fromCharCode(...bytes.subarray(i, i + 32_768));
  return btoa(binary);
}

export async function photoInsight(file: File): Promise<PhotoInsight> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = bitmap;
    const crop = Math.floor(Math.min(width, height) / 3);
    const [image, detail] = await Promise.all([
      jpegBase64(bitmap, 0, 0, width, height, 768),
      jpegBase64(bitmap, Math.floor((width - crop) / 2), Math.floor((height - crop) / 2), crop, crop, 768),
    ]);
    return await fieldOperation("photo-insight", { image, detail }) as PhotoInsight;
  } finally {
    bitmap.close();
  }
}

/** The stage most photos agree on (ignoring "unknown"), or null. */
export function surveyStage(insights: Array<PhotoInsight | null | undefined>): CropStage | null {
  const counts = new Map<CropStage, number>();
  for (const item of insights) if (item && item.crop_stage !== "unknown") counts.set(item.crop_stage, (counts.get(item.crop_stage) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

const CONDITION_FIELDS: Array<[RegExp, string]> = [
  [/flood|submergence/i, "standing_water"],
  [/lodging/i, "lodging"],
  [/drought/i, "dry_or_cracked_soil"],
  [/deficiency|toxicity/i, "nutrient_stress_suspected"],
  [/borer|planthopper|hopperburn|folder|hispa|rice bug|rat|snail/i, "pest_damage_suspected"],
];

/** Field-condition checkboxes suggested by conditions Gemma rated at 50% or more. */
export function suggestedFieldConditions(insights: Array<PhotoInsight | null | undefined>): string[] {
  const found = new Set<string>();
  for (const item of insights) for (const condition of item?.conditions || [])
    if (condition.confidence >= 0.5) for (const [pattern, field] of CONDITION_FIELDS) if (pattern.test(condition.name)) found.add(field);
  return [...found];
}
