/** Shared browser/Edge contract. No credentials or provider-specific secrets. */
export const DISEASES = ["BLB", "Brown Spot"] as const;
export type DiseaseName = typeof DISEASES[number];
export const TILE_SIZE = 1024;
export const TILE_STRIDE = 768;
export const TARGET_FPS = 5;
export const REVIEW_FPS_OPTIONS = [5, 30] as const;
export type ReviewFps = typeof REVIEW_FPS_OPTIONS[number];
export const MAX_IMAGE_PIXELS = 60_000_000;
export type FindingDecision = "pending" | "accepted" | "rejected";
export interface DiseaseFinding {
  disease: DiseaseName;
  status: "detected" | "not_detected" | "failed";
  predicted_pixels: number;
  mask_meaning: "disease_region" | "affected_leaf";
  mask_path: string | null;
  review_decision: FindingDecision;
  quality_flags: string[];
}
export interface ResultMedia {
  source_asset_id: string;
  type: "image" | "video";
  variant: "original" | "BLB" | "Brown Spot" | "combined" | "video" | "publication_candidate";
  path: string;
  width: number;
  height: number;
  sanitized: boolean;
  alt: string;
  sha256?: string;
}
export interface ModelBundle {
  id: string;
  workflow_id: string;
  workflow_sha256: string;
  models: Record<DiseaseName, {
    model_id: string;
    version: string;
    artifact_sha256: string;
    foreground_class_id: number;
    input_size: 1024;
    overlap: 0.25;
    preprocessing: string;
  }>;
}
export interface VideoFrameReceipt {
  index: number;
  source_time_seconds: number;
  source_sha256: string;
  mask_members: Record<DiseaseName, string>;
}
export interface VideoFrameSeries {
  clip_start_seconds: number;
  clip_duration_seconds: number;
  fps: 30;
  linked_photo_asset_id: string;
  mask_archive_path: string;
  mask_archive_sha256: string;
  review_video_sha256: string;
  publication_video_sha256: string;
  frames: VideoFrameReceipt[];
}
export interface ResultV2 {
  schema_version: "riceguard.result.v2";
  run_id: string;
  source_manifest_hash: string;
  model_bundle: ModelBundle;
  assets: Array<{
    source_asset_id: string;
    kind: "image" | "video";
    width: number;
    height: number;
    status: "complete" | "failed";
    diseases: DiseaseFinding[];
    review_paths: Record<string, string>;
    location: { source: "exif" | "dji_xmp" | "linked_photo" | "missing"; lat: number | null; lng: number | null; reference_asset_id?: string };
    capture_time: string | null;
    quality_flags: string[];
    ambiguous_overlap_pixels: number;
    frame_series?: VideoFrameSeries;
  }>;
  media: ResultMedia[];
  /** Private object-store receipts. Required for the pinned Kaggle callback. */
  artifacts?: Record<string, { sha256: string; bytes: number }>;
  severity: { value: null; method_version: null; scope: "visible_leaf_area"; availability_reason: "lesion_measurement_not_validated" };
  warnings: string[];
}
export function tileCount(width: number, height: number): number {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0)) throw new Error("Invalid dimensions");
  return Math.max(1, Math.ceil((width - TILE_SIZE) / TILE_STRIDE) + 1)
    * Math.max(1, Math.ceil((height - TILE_SIZE) / TILE_STRIDE) + 1);
}
export function clipSettings(start: number, duration: number, sourceDuration: number, targetFps: ReviewFps = TARGET_FPS) {
  if (![start, duration, sourceDuration].every(Number.isFinite) || start < 0 || duration <= 0 || duration > 30 || start + duration > sourceDuration + 0.01)
    throw new Error("Pumili ng valid video clip na hanggang 30 seconds.");
  if (!REVIEW_FPS_OPTIONS.includes(targetFps)) throw new Error("Unsupported review frame rate.");
  return { start_seconds: start, duration_seconds: duration, target_fps: targetFps };
}
export function estimateCredits(width: number, height: number, duration?: number, targetFps: ReviewFps = TARGET_FPS): number {
  if (!REVIEW_FPS_OPTIONS.includes(targetFps)) throw new Error("Unsupported review frame rate.");
  const frames = duration === undefined ? 1 : Math.ceil(duration * targetFps);
  if (!Number.isFinite(frames) || frames < 1 || (duration !== undefined && duration > 30)) throw new Error("Invalid clip duration");
  return tileCount(width, height) * frames * DISEASES.length * 0.25 / 1000;
}
export function validCoordinates(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}
export function bulletinDiseases(value: { disease: DiseaseName; diseases?: DiseaseName[] }): DiseaseName[] {
  return value.diseases?.length ? DISEASES.filter((name) => value.diseases!.includes(name)) : [value.disease];
}
/** A callback must match every source, pinned model, and authorized artifact prefix. */
export function validateResultV2(value: unknown, expected: {
  run_id: string; manifest_hash: string; asset_ids: string[]; path_prefix: string; model_bundle: ModelBundle;
  video_clips?: Record<string, { start_seconds: number; duration_seconds: number; fps: 30; linked_photo_asset_id: string }>;
}): ResultV2 {
  const r = value as ResultV2;
  if (!r || r.schema_version !== "riceguard.result.v2" || r.run_id !== expected.run_id || r.source_manifest_hash !== expected.manifest_hash)
    throw new Error("Result does not match this run");
  if (JSON.stringify(r.model_bundle) !== JSON.stringify(expected.model_bundle)) throw new Error("Pinned model bundle mismatch");
  if (!Array.isArray(r.assets) || r.assets.length !== expected.asset_ids.length || new Set(r.assets.map((a) => a.source_asset_id)).size !== expected.asset_ids.length)
    throw new Error("Missing or duplicate result assets");
  const safePath = (path: unknown) => typeof path === "string" && path.startsWith(expected.path_prefix) && !path.includes("..") && !path.includes("?") && !path.includes(":");
  const byId = new Map(r.assets.map((asset) => [asset.source_asset_id, asset]));
  for (const a of r.assets) {
    if (!expected.asset_ids.includes(a.source_asset_id) || !["image", "video"].includes(a.kind) || a.status !== "complete" || ![a.width, a.height].every((n) => Number.isInteger(n) && n > 0) || a.width * a.height > MAX_IMAGE_PIXELS)
      throw new Error("Incomplete result or invalid native dimensions");
    if (!Array.isArray(a.diseases) || a.diseases.length !== 2 || new Set(a.diseases.map((d) => d.disease)).size !== 2 || a.diseases.some((d) => !DISEASES.includes(d.disease)))
      throw new Error("Both specialist findings are required");
    for (const d of a.diseases) {
      if (!DISEASES.includes(d.disease) || !["detected", "not_detected"].includes(d.status) || !Number.isInteger(d.predicted_pixels) || d.predicted_pixels < 0 || (a.kind === "image" && d.predicted_pixels > a.width * a.height) || (d.status === "detected") !== (d.predicted_pixels > 0) || d.review_decision !== "pending")
        throw new Error("Invalid disease finding");
      if (d.mask_meaning !== (d.disease === "BLB" ? "disease_region" : "affected_leaf")) throw new Error("Invalid mask meaning");
      if (!safePath(d.mask_path)) throw new Error("Each specialist must provide a private mask artifact");
    }
    const location = a.location;
    if (!location || !["exif", "dji_xmp", "linked_photo", "missing"].includes(location.source) ||
      (location.source === "missing" ? location.lat !== null || location.lng !== null : !validCoordinates(location.lat, location.lng)))
      throw new Error("Invalid verified location");
    if (location.source === "linked_photo") {
      const photo = location.reference_asset_id ? byId.get(location.reference_asset_id) : undefined;
      if (a.kind !== "video" || !photo || photo.kind !== "image" ||
        !["exif", "dji_xmp"].includes(photo.location?.source) ||
        !validCoordinates(photo.location?.lat, photo.location?.lng) ||
        Math.abs(photo.location.lat - location.lat!) > 0.000001 ||
        Math.abs(photo.location.lng! - location.lng!) > 0.000001)
        throw new Error("Video location must match a verified source photo");
    }
    if (a.kind === "video" && !["linked_photo", "missing"].includes(location.source))
      throw new Error("Video cannot claim its own photo GPS");
    if (a.kind === "image" && a.frame_series !== undefined)
      throw new Error("Photo cannot contain video frame receipts");
    if (a.kind === "video") {
      const expectedClip = expected.video_clips?.[a.source_asset_id];
      const series = a.frame_series;
      const photo = series ? byId.get(series.linked_photo_asset_id) : undefined;
      if (!expectedClip || !series || !photo || photo.kind !== "image" ||
        series.linked_photo_asset_id !== expectedClip.linked_photo_asset_id ||
        series.clip_start_seconds !== expectedClip.start_seconds ||
        series.clip_duration_seconds !== expectedClip.duration_seconds ||
        series.fps !== expectedClip.fps || series.fps !== 30 ||
        series.clip_duration_seconds <= 0 || series.clip_duration_seconds > 30 ||
        (location.source === "linked_photo" && location.reference_asset_id !== series.linked_photo_asset_id))
        throw new Error("Video clip does not match the authorized source and linked photo");
      if (!safePath(series.mask_archive_path) || !/^[a-f0-9]{64}$/.test(series.mask_archive_sha256) ||
        !/^[a-f0-9]{64}$/.test(series.review_video_sha256))
        throw new Error("The private video archive and review MP4 require verified hashes");
      if (a.diseases.some((finding) => finding.mask_path !== series.mask_archive_path))
        throw new Error("Video specialist masks must reference the verified frame archive");
      const frameCount = Math.round(series.clip_duration_seconds * series.fps);
      if (!Array.isArray(series.frames) || frameCount < 1 || frameCount > 900 ||
        Math.abs(series.clip_duration_seconds * series.fps - frameCount) > 0.01 ||
        series.frames.length !== frameCount)
        throw new Error("Every selected video frame must have an independent receipt");
      const members = new Set<string>();
      for (const [index, frame] of series.frames.entries()) {
        if (frame.index !== index ||
          Math.abs(frame.source_time_seconds - (series.clip_start_seconds + index / series.fps)) > 0.001 ||
          !/^[a-f0-9]{64}$/.test(frame.source_sha256) ||
          !frame.mask_members ||
          frame.mask_members.BLB !== `masks/frame_${String(index + 1).padStart(6, "0")}_blb.png` ||
          frame.mask_members["Brown Spot"] !== `masks/frame_${String(index + 1).padStart(6, "0")}_brownspot.png`)
          throw new Error("Invalid video frame receipt or missing specialist mask");
        const frameMembers = DISEASES.map((disease) => frame.mask_members[disease]);
        if (frameMembers.some((member) => members.has(member))) throw new Error("Video frames cannot reuse mask artifacts");
        frameMembers.forEach((member) => members.add(member));
      }
    }
    const requiredVariants = a.kind === "image" ? ["original", "BLB", "Brown Spot", "combined"] : ["video"];
    if (!a.review_paths || requiredVariants.some((variant) => !safePath(a.review_paths[variant])) || Object.values(a.review_paths).some((path) => !safePath(path)))
      throw new Error("Private review variants are missing");
  }
  if (!Array.isArray(r.media) || !r.media.length || r.media.some((m) => !expected.asset_ids.includes(m.source_asset_id) || !safePath(m.path) || m.sanitized !== true || !["image", "video"].includes(m.type)) ||
    expected.asset_ids.some((id) => !r.media.some((m) => m.source_asset_id === id && m.type === byId.get(id)?.kind)))
    throw new Error("Sanitized review media required for every asset");
  for (const asset of r.assets.filter((item) => item.kind === "video")) {
    const video = r.media.find((item) => item.source_asset_id === asset.source_asset_id && item.type === "video" && item.variant === "video");
    const publication = r.media.find((item) => item.source_asset_id === asset.source_asset_id && item.type === "video" && item.variant === "publication_candidate");
    if (!video || video.path !== asset.review_paths.video || video.sha256 !== asset.frame_series?.review_video_sha256 ||
      video.width !== asset.width || video.height !== asset.height)
      throw new Error("Review MP4 does not match the verified native video result");
    if (!publication || publication.sha256 !== asset.frame_series?.publication_video_sha256 ||
      publication.width !== asset.width || publication.height !== asset.height)
      throw new Error("Sanitized publication MP4 does not match the native video result");
  }
  if (r.severity?.value !== null || r.severity?.method_version !== null || r.severity?.scope !== "visible_leaf_area" || r.severity?.availability_reason !== "lesion_measurement_not_validated")
    throw new Error("Unvalidated severity is not publishable");
  return r;
}
