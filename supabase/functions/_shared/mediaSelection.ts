/** Server-side source contract for private two-specialist processing jobs. */
export interface SourceAsset {
  id: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds?: number | null;
  clip_start_seconds?: number | null;
  clip_duration_seconds?: number | null;
  clip_target_fps?: number | null;
  linked_photo_asset_id?: string | null;
  state: string;
}

const PHOTO_MIMES = new Set(["image/jpeg", "image/png"]);
const MAX_PHOTO_BYTES = 200_000_000;
const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 60_000_000;

function dimensions(asset: SourceAsset) {
  return Number.isInteger(asset.width) && Number.isInteger(asset.height) &&
    Number(asset.width) > 0 && Number(asset.height) > 0 &&
    Number(asset.width) * Number(asset.height) <= MAX_IMAGE_PIXELS;
}

export function validateVideoClipSelection(sourceDuration: number, start: number, duration: number, fps: number) {
  if (![sourceDuration, start, duration, fps].every((value) => typeof value === "number" && Number.isFinite(value)) || sourceDuration <= 0 ||
    start < 0 || duration <= 0 || duration > 30 || start + duration > sourceDuration + 0.01 || fps !== 30)
    throw new Error("Select a source-bounded clip of at most 30 seconds at 30 FPS");
  const frames = duration * fps;
  if (Math.abs(frames - Math.round(frames)) > 0.01)
    throw new Error("The selected clip must align to 30 FPS frames");
  return { start_seconds: start, duration_seconds: duration, target_fps: 30 as const, frame_count: Math.round(frames) };
}

/** Does not infer GPS from video or turn missing photo GPS into a location. */
export function validateMediaSelection(assets: SourceAsset[], provider: "aws" | "kaggle_yolo26") {
  if (!Array.isArray(assets) || !assets.length || assets.some((asset) => asset.state !== "Verified"))
    throw new Error("All source assets must be verified before processing");
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length)
    throw new Error("Duplicate source asset identifiers");

  const photos = assets.filter((asset) => PHOTO_MIMES.has(asset.mime));
  const videos = assets.filter((asset) => asset.mime === "video/mp4");
  if (photos.length < 1 || photos.length > 10 ||
    photos.some((photo) => !dimensions(photo) || !Number.isInteger(photo.bytes) || photo.bytes < 1 || photo.bytes > MAX_PHOTO_BYTES))
    throw new Error("Processing requires one to ten verified JPEG/PNG photos up to 60 MP and 200 MB each");
  if (photos.length + videos.length !== assets.length || videos.length > 1)
    throw new Error("Only one optional MP4 presentation clip is supported");
  if (provider === "aws") {
    if (videos.length) throw new Error("The AWS photo worker cannot process video");
    return { photos, video: null };
  }
  if (videos.length) {
    const video = videos[0];
    if (!dimensions(video) || !Number.isInteger(video.bytes) || video.bytes < 1 || video.bytes > MAX_VIDEO_BYTES)
      throw new Error("Invalid native MP4 dimensions or file size");
    validateVideoClipSelection(video.duration_seconds as number, video.clip_start_seconds as number,
      video.clip_duration_seconds as number, video.clip_target_fps as number);
    if (!photos.some((photo) => photo.id === video.linked_photo_asset_id))
      throw new Error("The video must reference a verified photo in the same survey");
    return { photos, video };
  }
  return { photos, video: null };
}
