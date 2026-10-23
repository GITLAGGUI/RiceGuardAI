import { validateResultV2, type ModelBundle, type ResultV2 } from "../../../shared/inference.ts";

// This hash includes every packaged Kaggle worker/adapter source and the
// private two-specialist bundle. Changing any source requires a new pin.
// New jobs use the lesion bundle (b10 UNet ConvNeXt-B for BLB, YOLO26l for Brown Spot).
export const PINNED_KAGGLE_WORKFLOW_SHA256 = "20d3fc452a6f4575791162fbf28a21a592cf7b9ea8992852940e165459b03eb2";
const YOLO26M_WORKFLOWS = [
  "df3d156e64d778ea818fdb34005a340570661d40e0d9a306ec891087f68a35de",
  "09533f998a7e51ad8f44703aef1d7dee8eb91b4251681a538cabe881b5bec5b0",
  "7695ca57f8d093c05fe73c916bb9c13315b615b6210ef76343dae0423a84ab62",
];
export const isSupportedPinnedWorkflow = (hash: unknown): hash is string =>
  hash === PINNED_KAGGLE_WORKFLOW_SHA256 || YOLO26M_WORKFLOWS.includes(hash as string);
export const LESION_BUNDLE = {
  id: "riceguard-b10unet-yolo26l-20261023",
  models: {
    BLB: "7006f33bf08cdfe291a2e3907b28e9e71107289ad6ea81299c9c9b17e98bdf17",
    "Brown Spot": "b311478a6c47e353c353b9ec060a3e885ad431394d7dade04b6972fd59060b33",
  },
} as const;
const YOLO26M_BUNDLE = {
  id: "riceguard-yolo26m-semantic-20260928",
  models: {
    BLB: "aa10d1f6c03baf189c56484db99e96ba55c646be1668d102bdaed78a43315bc6",
    "Brown Spot": "58a1f4600887577749a22f7a8b43b81174bb082d68afd5f09f1079b79a18bca5",
  },
} as const;
export const expectedBundle = (workflow: unknown) =>
  workflow === PINNED_KAGGLE_WORKFLOW_SHA256 ? LESION_BUNDLE : YOLO26M_BUNDLE;

export interface PinnedJob {
  provider: string;
  run_id: string;
  manifest_hash: string;
  manifest: {
    execution_provider?: string;
    pinned_workflow_sha256?: string;
    assets?: Array<{
      id: string; mime: string; width: number; height: number; state: string;
      clip_start_seconds?: number; clip_duration_seconds?: number; clip_target_fps?: number;
      linked_photo_asset_id?: string | null;
    }>;
  };
}

export function validatePinnedResult(manifest: unknown, job: PinnedJob): ResultV2 {
  if (job.provider !== "kaggle_yolo26" || job.manifest.execution_provider !== "kaggle_yolo26" ||
    !isSupportedPinnedWorkflow(job.manifest.pinned_workflow_sha256))
    throw new Error("Pinned Kaggle job was not authorized");
  const submitted = job.manifest.assets;
  if (!Array.isArray(submitted) || submitted.length < 1 || submitted.length > 11 ||
    new Set(submitted.map((asset) => asset.id)).size !== submitted.length ||
    submitted.some((asset) => asset.state !== "Verified" || !["image/jpeg", "image/png", "video/mp4"].includes(asset.mime) ||
      !Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width <= 0 || asset.height <= 0 ||
      asset.width * asset.height > 60_000_000))
    throw new Error("Pinned Kaggle source assets are incomplete");
  const photos = submitted.filter((asset) => asset.mime !== "video/mp4");
  const videos = submitted.filter((asset) => asset.mime === "video/mp4");
  if (photos.length < 1 || photos.length > 10 || videos.length > 1)
    throw new Error("One to ten verified photos and at most one video are required");
  const clips: Record<string, { start_seconds: number; duration_seconds: number; fps: 30; linked_photo_asset_id: string }> = {};
  for (const video of videos) {
    if (!photos.some((photo) => photo.id === video.linked_photo_asset_id) ||
      !Number.isFinite(video.clip_start_seconds) || !Number.isFinite(video.clip_duration_seconds) ||
      video.clip_start_seconds! < 0 || video.clip_duration_seconds! <= 0 || video.clip_duration_seconds! > 30 ||
      video.clip_target_fps !== 30)
      throw new Error("Video clip needs an authorized linked GPS photo and 30 FPS selection");
    clips[video.id] = {
      start_seconds: video.clip_start_seconds!, duration_seconds: video.clip_duration_seconds!, fps: 30,
      linked_photo_asset_id: video.linked_photo_asset_id!,
    };
  }
  const result = manifest as ResultV2;
  const bundle = result?.model_bundle as ModelBundle | undefined;
  const pinned = expectedBundle(job.manifest.pinned_workflow_sha256);
  if (bundle?.id !== pinned.id ||
    bundle.workflow_id !== "kaggle-private-two-specialist-media-v1" ||
    bundle.workflow_sha256 !== job.manifest.pinned_workflow_sha256 ||
    bundle.models?.BLB?.artifact_sha256 !== pinned.models.BLB ||
    bundle.models?.["Brown Spot"]?.artifact_sha256 !== pinned.models["Brown Spot"] ||
    [bundle.models.BLB, bundle.models["Brown Spot"]].some((model) =>
      model.foreground_class_id !== 1 || model.input_size !== 1024 || model.overlap !== 0.25))
    throw new Error("Unpinned Kaggle specialist bundle");
  const checked = validateResultV2(result, {
    run_id: job.run_id, manifest_hash: job.manifest_hash,
    asset_ids: submitted.map((asset) => asset.id),
    path_prefix: `website-inference/v2/jobs/${job.run_id}/outputs/`,
    model_bundle: bundle, video_clips: clips, lesion_contract: pinned === LESION_BUNDLE,
  });
  for (const asset of checked.assets) {
    const source = submitted.find((item) => item.id === asset.source_asset_id)!;
    if (asset.kind !== (source.mime === "video/mp4" ? "video" : "image") ||
      asset.width !== source.width || asset.height !== source.height)
      throw new Error("Result dimensions or media type differ from the verified source");
  }
  if (videos.length && !checked.assets.some((asset) => asset.kind === "video"))
    throw new Error("Video result is missing");
  const referenced = new Set<string>();
  for (const asset of checked.assets) {
    for (const finding of asset.diseases) referenced.add(finding.mask_path!);
    for (const path of Object.values(asset.review_paths)) referenced.add(path);
  }
  for (const media of checked.media) referenced.add(media.path);
  const artifacts = checked.artifacts;
  if (!artifacts || Object.keys(artifacts).length !== referenced.size ||
    [...referenced].some((path) => !Object.hasOwn(artifacts, path)) ||
    Object.entries(artifacts).some(([path, receipt]) => !referenced.has(path) ||
      !/^[a-f0-9]{64}$/.test(receipt?.sha256) || !Number.isSafeInteger(receipt?.bytes) || receipt.bytes < 1))
    throw new Error("Every private mask and review asset needs a matching upload receipt");
  for (const asset of checked.assets.filter((item) => item.kind === "video")) {
    const series = asset.frame_series!;
    if (artifacts[series.mask_archive_path].sha256 !== series.mask_archive_sha256 ||
      artifacts[asset.review_paths.video].sha256 !== series.review_video_sha256)
      throw new Error("Video mask archive or MP4 digest differs from its frame receipts");
  }
  return checked;
}
