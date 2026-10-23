import { describe, expect, it } from "vitest";
import { PINNED_KAGGLE_WORKFLOW_SHA256, YOLO26M_WORKFLOWS, LESION_BUNDLE, isSupportedPinnedWorkflow, validatePinnedResult, type PinnedJob } from "../../../supabase/functions/_shared/pinnedResult";
const LEGACY_KAGGLE_WORKFLOW_SHA256 = YOLO26M_WORKFLOWS[2];
import type { ResultV2 } from "../../../shared/inference";

const id = "2c8d5f95-7a53-4f2d-a90c-302b7f2e60b8";
const clipId = "39e5e213-6049-4adb-b52d-642b783d28a0";
const prefix = "website-inference/v2/jobs/rg-test/outputs/";
const model = (sha: string) => ({ model_id: "pinned", version: sha.slice(0, 16), artifact_sha256: sha,
  foreground_class_id: 1, input_size: 1024 as const, overlap: 0.25 as const, preprocessing: "ultralytics_pil_rgb_letterbox" });
const job = (): PinnedJob => ({ provider: "kaggle_yolo26", run_id: "rg-test", manifest_hash: "f".repeat(64),
  manifest: { execution_provider: "kaggle_yolo26", pinned_workflow_sha256: PINNED_KAGGLE_WORKFLOW_SHA256,
    assets: [{ id, mime: "image/jpeg", width: 640, height: 512, state: "Verified" }] } });
const web = ["web-original.jpg", "web-combined.jpg", "layer-blb.png", "layer-brown-spot.png"];
// Current lesion bundle: lesion masks, plant-tissue measurements and web-sized variants.
const result = (): ResultV2 => ({ schema_version: "riceguard.result.v2", run_id: "rg-test",
  source_manifest_hash: "f".repeat(64),
  model_bundle: { id: LESION_BUNDLE.id, workflow_id: "kaggle-private-two-specialist-media-v1",
    workflow_sha256: PINNED_KAGGLE_WORKFLOW_SHA256,
    models: { BLB: model(LESION_BUNDLE.models.BLB), "Brown Spot": model(LESION_BUNDLE.models["Brown Spot"]) } },
  assets: [{ source_asset_id: id, kind: "image", width: 640, height: 512, status: "complete",
    diseases: [
      { disease: "BLB", status: "detected", predicted_pixels: 15, mask_meaning: "lesion_area",
        mask_path: prefix + "blb.png", review_decision: "pending", quality_flags: [] },
      { disease: "Brown Spot", status: "not_detected", predicted_pixels: 0, mask_meaning: "lesion_area",
        mask_path: prefix + "brownspot.png", review_decision: "pending", quality_flags: [] },
    ], review_paths: { original: prefix + "original.jpg", BLB: prefix + "blb.jpg",
      "Brown Spot": prefix + "brownspot.jpg", combined: prefix + "combined.jpg",
      web_original: prefix + web[0], web_combined: prefix + web[1], layer_BLB: prefix + web[2], "layer_Brown Spot": prefix + web[3] },
    location: { source: "missing", lat: null, lng: null }, capture_time: null,
    measurements: { method: "exg_otsu_hsv_v1", frame_pixels: 640 * 512, plant_pixels: 1000, lesion_pixels: { BLB: 15, "Brown Spot": 0 } },
    quality_flags: [], ambiguous_overlap_pixels: 0 }],
  media: [{ source_asset_id: id, type: "image", variant: "combined", path: prefix + "combined.jpg",
    width: 640, height: 512, sanitized: true, alt: "Private review" }],
  artifacts: Object.fromEntries(["blb.png", "brownspot.png", "original.jpg", "blb.jpg", "brownspot.jpg", "combined.jpg", ...web]
    .map((name) => [prefix + name, { sha256: "d".repeat(64), bytes: 100 }])),
  severity: { value: null, method_version: null, scope: "visible_leaf_area",
    availability_reason: "lesion_measurement_not_validated" }, warnings: [],
});
// A YOLO26m-era result: historical meanings, no measurements or web variants.
const legacyResult = (): ResultV2 => {
  const r = result();
  r.model_bundle = { ...r.model_bundle, id: "riceguard-yolo26m-semantic-20260928", workflow_sha256: LEGACY_KAGGLE_WORKFLOW_SHA256,
    models: { BLB: model("aa10d1f6c03baf189c56484db99e96ba55c646be1668d102bdaed78a43315bc6"),
      "Brown Spot": model("58a1f4600887577749a22f7a8b43b81174bb082d68afd5f09f1079b79a18bca5") } };
  const a = r.assets[0];
  a.diseases[0].mask_meaning = "disease_region"; a.diseases[1].mask_meaning = "affected_leaf";
  delete a.measurements;
  for (const key of ["web_original", "web_combined", "layer_BLB", "layer_Brown Spot"]) delete a.review_paths[key];
  for (const name of web) delete r.artifacts![prefix + name];
  return r;
};

describe("pinned Kaggle result acceptance", () => {
  it("preserves old jobs but rejects cross-version results and unknown workflows", () => {
    const oldJob = job(); oldJob.manifest.pinned_workflow_sha256 = LEGACY_KAGGLE_WORKFLOW_SHA256;
    const oldResult = legacyResult();
    expect(validatePinnedResult(oldResult, oldJob).assets).toHaveLength(1);
    expect(() => validatePinnedResult(result(), oldJob)).toThrow("Unpinned");
    expect(() => validatePinnedResult(oldResult, job())).toThrow("Unpinned");
    const unmeasured = result(); delete unmeasured.assets[0].measurements;
    expect(() => validatePinnedResult(unmeasured, job())).toThrow("measurements");
    expect(isSupportedPinnedWorkflow(null)).toBe(false);
    expect(isSupportedPinnedWorkflow("0".repeat(64))).toBe(false);
  });
  it("accepts only a matching immutable two-specialist photo run", () => {
    expect(validatePinnedResult(result(), job()).assets[0].diseases).toHaveLength(2);
    const wrong = job(); wrong.manifest.assets![0].width = 800;
    expect(() => validatePinnedResult(result(), wrong)).toThrow("dimensions");
  });
  it("rejects legacy provider and a changed worker workflow", () => {
    const legacy = job(); legacy.provider = "kaggle";
    expect(() => validatePinnedResult(result(), legacy)).toThrow("not authorized");
    const changed = result(); changed.model_bundle.workflow_sha256 = "0".repeat(64);
    expect(() => validatePinnedResult(changed, job())).toThrow("Unpinned");
  });
  it("requires every video frame to carry both masks and a linked source photo", () => {
    const selected = job();
    selected.manifest.assets!.push({ id: clipId, mime: "video/mp4", width: 640, height: 512,
      state: "Verified", clip_start_seconds: 10, clip_duration_seconds: 1 / 30,
      clip_target_fps: 30, linked_photo_asset_id: id });
    const output = result();
    output.assets.push({ source_asset_id: clipId, kind: "video", width: 640, height: 512, status: "complete",
      diseases: output.assets[0].diseases.map((finding) => ({ ...finding, mask_path: prefix + "masks.zip" })),
      review_paths: { video: prefix + "review.mp4" }, location: { source: "missing", lat: null, lng: null },
      capture_time: null, quality_flags: [], ambiguous_overlap_pixels: 0,
      frame_series: { clip_start_seconds: 10, clip_duration_seconds: 1 / 30, fps: 30,
        linked_photo_asset_id: id, mask_archive_path: prefix + "masks.zip",
        mask_archive_sha256: "a".repeat(64), review_video_sha256: "b".repeat(64),
        publication_video_sha256: "e".repeat(64),
        frames: [{ index: 0, source_time_seconds: 10, source_sha256: "c".repeat(64),
          mask_members: { BLB: "masks/frame_000001_blb.png", "Brown Spot": "masks/frame_000001_brownspot.png" } }] } });
    output.media.push({ source_asset_id: clipId, type: "video", variant: "video", path: prefix + "review.mp4",
      width: 640, height: 512, sanitized: true, alt: "Private video", sha256: "b".repeat(64) });
    output.media.push({ source_asset_id: clipId, type: "video", variant: "publication_candidate",
      path: prefix + "publication_candidate.mp4", width: 640, height: 512, sanitized: true,
      alt: "Private publication candidate", sha256: "e".repeat(64) });
    output.artifacts![prefix + "masks.zip"] = { sha256: "a".repeat(64), bytes: 100 };
    output.artifacts![prefix + "review.mp4"] = { sha256: "b".repeat(64), bytes: 100 };
    output.artifacts![prefix + "publication_candidate.mp4"] = { sha256: "e".repeat(64), bytes: 100 };
    expect(validatePinnedResult(output, selected).assets).toHaveLength(2);
    output.assets[1].frame_series!.frames[0].mask_members.BLB = "masks/frame_000002_blb.png";
    expect(() => validatePinnedResult(output, selected)).toThrow("frame receipt");
  });
});
