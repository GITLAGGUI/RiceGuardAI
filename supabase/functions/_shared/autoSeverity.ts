// Automated severity from worker pixel counts (see docs/full-automation-v3-20261023.md).
// Per disease: pick the photo with the highest diseased share of plant tissue, then grade
// that percentage on the IRRI Standard Evaluation System (SES) for Rice.

export type Disease = "BLB" | "Brown Spot";
export type Category = "low" | "moderate" | "high";
export const DISEASES: Disease[] = ["BLB", "Brown Spot"];
export const MIN_PLANT_SHARE = 0.02;

export interface PhotoInput {
  source_asset_id: string;
  index: number;
  frame_pixels: number;
  plant_pixels: number;
  lesion_pixels: Record<Disease, number>;
  /** Findings that count for this run: all detections before review, accepted ones after. */
  counted: Record<Disease, boolean>;
}

export interface DiseaseSeverity {
  percent: number;
  ses_score: number;
  category: Category;
  representative_asset_id: string;
  photo_number: number;
  lesion_pixels: number;
  plant_pixels: number;
  affected_photos: number;
  usable_photos: number;
}

export interface SeverityDetail {
  method: "representative_photo_ses_v1";
  formula: string;
  overall: Category;
  photos: number;
  usable_photos: number;
  diseases: Partial<Record<Disease, DiseaseSeverity>>;
}

/** IRRI SES 2013: BLB 1 = 1-5 %, 3 = 6-12 %, 5 = 13-25 %, 7 = 26-50 %, 9 = 51-100 % lesion area. */
export function blbScore(percent: number): number {
  if (percent <= 0) return 0;
  if (percent <= 5) return 1;
  if (percent <= 12) return 3;
  if (percent <= 25) return 5;
  if (percent <= 50) return 7;
  return 9;
}

/** IRRI SES 2013: Brown Spot 1 < 1 %, 2 = 1-3, 3 = 4-5, 4 = 6-10, 5 = 11-15, 6 = 16-25, 7 = 26-50, 8 = 51-75, 9 = 76-100. */
export function brownSpotScore(percent: number): number {
  if (percent <= 0) return 0;
  if (percent < 1) return 1;
  const upper = [3, 5, 10, 15, 25, 50, 75]; // upper bounds of scores 2..8
  const index = upper.findIndex((limit) => percent <= limit);
  return index === -1 ? 9 : index + 2;
}

export function categoryFor(disease: Disease, score: number): Category {
  if (disease === "BLB") return score <= 3 ? "low" : score === 5 ? "moderate" : "high";
  return score <= 3 ? "low" : score <= 5 ? "moderate" : "high";
}

const rank: Record<Category, number> = { low: 0, moderate: 1, high: 2 };

export function computeSeverity(photos: PhotoInput[]): SeverityDetail | null {
  const usable = photos.filter((photo) => photo.frame_pixels > 0 && photo.plant_pixels / photo.frame_pixels >= MIN_PLANT_SHARE);
  const diseases: Partial<Record<Disease, DiseaseSeverity>> = {};
  for (const disease of DISEASES) {
    const affected = photos.filter((photo) => photo.counted[disease] && photo.lesion_pixels[disease] > 0 && photo.plant_pixels > 0);
    if (!affected.length) continue;
    // Prefer usable photos; a disease seen only on a poor photo still gets graded from it.
    const pool = affected.filter((photo) => usable.includes(photo));
    const candidates = pool.length ? pool : affected;
    const share = (photo: PhotoInput) => photo.lesion_pixels[disease] / photo.plant_pixels;
    const worst = candidates.reduce((best, photo) =>
      share(photo) > share(best) || (share(photo) === share(best) && photo.lesion_pixels[disease] > best.lesion_pixels[disease]) ? photo : best);
    const percent = Math.round(share(worst) * 10000) / 100;
    const score = disease === "BLB" ? blbScore(percent) : brownSpotScore(percent);
    diseases[disease] = {
      percent, ses_score: score, category: categoryFor(disease, score),
      representative_asset_id: worst.source_asset_id, photo_number: worst.index + 1,
      lesion_pixels: worst.lesion_pixels[disease], plant_pixels: worst.plant_pixels,
      affected_photos: affected.length, usable_photos: usable.length,
    };
  }
  const graded = Object.values(diseases);
  if (!graded.length) return null;
  const overall = graded.reduce<Category>((top, item) => rank[item!.category] > rank[top] ? item!.category : top, "low");
  return {
    method: "representative_photo_ses_v1",
    formula: "severity % = diseased pixels ÷ rice-plant pixels × 100, on the most affected photo",
    overall, photos: photos.length, usable_photos: usable.length, diseases,
  };
}

/** Build inputs from a result-v2 manifest. Video assets have no plant measurement and are skipped. */
export function photosFromManifest(
  manifest: { assets?: Array<Record<string, unknown>> },
  counts: (assetId: string, disease: Disease) => boolean,
): PhotoInput[] {
  const photos: PhotoInput[] = [];
  for (const asset of manifest.assets || []) {
    const m = asset.measurements as { frame_pixels?: number; plant_pixels?: number; lesion_pixels?: Record<Disease, number> } | undefined;
    if (asset.kind !== "image" || !m?.lesion_pixels) continue;
    const id = String(asset.source_asset_id);
    photos.push({
      source_asset_id: id, index: photos.length, frame_pixels: Number(m.frame_pixels), plant_pixels: Number(m.plant_pixels),
      lesion_pixels: { BLB: Number(m.lesion_pixels.BLB), "Brown Spot": Number(m.lesion_pixels["Brown Spot"]) },
      counted: { BLB: counts(id, "BLB"), "Brown Spot": counts(id, "Brown Spot") },
    });
  }
  return photos;
}
