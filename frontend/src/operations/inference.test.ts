import { describe, expect, it } from "vitest";
import { bulletinDiseases, clipSettings, estimateCredits, tileCount, validCoordinates, validateResultV2, type ModelBundle, type ResultV2 } from "../../../shared/inference";
describe("two-specialist upload contract", () => {
  it("estimates native-resolution tiles and both models", () => {
    expect(tileCount(8064, 6048)).toBe(88);
    expect(estimateCredits(8064, 6048)).toBeCloseTo(0.044);
    expect(estimateCredits(3840, 2160, 30)).toBeCloseTo(1.125);
    expect(estimateCredits(3840, 2160, 30, 30)).toBeCloseTo(6.75);
    expect(tileCount(1024, 1024)).toBe(1);
  });
  it("rejects malformed dimensions and overlong clips", () => {
    expect(() => tileCount(0, 1024)).toThrow();
    expect(() => clipSettings(0, 31, 60)).toThrow();
    expect(() => clipSettings(50, 20, 60)).toThrow();
    expect(clipSettings(10, 30, 60).target_fps).toBe(5);
    expect(clipSettings(10, 30, 60, 30).target_fps).toBe(30);
    expect(() => clipSettings(10, 31, 60, 30)).toThrow();
    expect(() => clipSettings(10, 20, 60, 24 as 30)).toThrow("Unsupported review frame rate");
  });
  it("preserves zero coordinates, rejects invalid GPS", () => {
    expect(validCoordinates(0, 0)).toBe(true);
    expect(validCoordinates(91, 122)).toBe(false);
    expect(validCoordinates(null, null)).toBe(false);
  });
  it("keeps both labels and supports historical single-disease posts", () => {
    expect(bulletinDiseases({ disease: "BLB", diseases: ["BLB", "Brown Spot"] })).toEqual(["BLB", "Brown Spot"]);
    expect(bulletinDiseases({ disease: "Brown Spot" })).toEqual(["Brown Spot"]);
  });
});

describe("result-v2 validation boundary", () => {
  const model = { model_id: "test-only/1", version: "test-only", artifact_sha256: "a".repeat(64), foreground_class_id: 1, input_size: 1024 as const, overlap: 0.25 as const, preprocessing: "test-only" };
  const bundle: ModelBundle = { id: "fixture", workflow_id: "fixture", workflow_sha256: "b".repeat(64), models: { BLB: model, "Brown Spot": model } };
  const expected = { run_id: "run", manifest_hash: "hash", asset_ids: ["photo"], path_prefix: "survey/job/", model_bundle: bundle };
  const result = (): ResultV2 => ({
    schema_version: "riceguard.result.v2", run_id: "run", source_manifest_hash: "hash", model_bundle: bundle,
    assets: [{ source_asset_id: "photo", kind: "image", width: 1024, height: 1024, status: "complete",
      diseases: [
        { disease: "BLB", status: "detected", predicted_pixels: 20, mask_meaning: "disease_region", mask_path: "survey/job/blb.png", review_decision: "pending", quality_flags: [] },
        { disease: "Brown Spot", status: "detected", predicted_pixels: 30, mask_meaning: "affected_leaf", mask_path: "survey/job/bs.png", review_decision: "pending", quality_flags: [] },
      ], review_paths: { original: "survey/job/original.webp", BLB: "survey/job/blb.webp", "Brown Spot": "survey/job/bs.webp", combined: "survey/job/combined.webp" }, location: { source: "missing", lat: null, lng: null }, capture_time: null, quality_flags: [], ambiguous_overlap_pixels: 5 }],
    media: [{ source_asset_id: "photo", type: "image", variant: "combined", path: "survey/job/combined.webp", width: 1024, height: 1024, sanitized: true, alt: "Fixture only" }],
    severity: { value: null, method_version: null, scope: "visible_leaf_area", availability_reason: "lesion_measurement_not_validated" }, warnings: [],
  });
  it("accepts independent positive disease masks", () => {
    expect(validateResultV2(result(), expected).assets[0].diseases).toHaveLength(2);
  });
  it("rejects partial failures rather than interpreting them as negative", () => {
    const r = result(); r.assets[0].diseases[1].status = "failed";
    expect(() => validateResultV2(r, expected)).toThrow("Invalid disease finding");
  });
  it("rejects missing sources and unauthorized media paths", () => {
    const r = result(); r.assets[0].source_asset_id = "another";
    expect(() => validateResultV2(r, expected)).toThrow();
    const bad = result(); bad.media[0].path = "another-survey/combined.webp";
    expect(() => validateResultV2(bad, expected)).toThrow();
  });
  it("rejects unsanitized exports and mismatched model bundles", () => {
    const r = result(); r.media[0].sanitized = false;
    expect(() => validateResultV2(r, expected)).toThrow();
    expect(() => validateResultV2(result(), { ...expected, model_bundle: { ...bundle, id: "different" } })).toThrow("Pinned model bundle mismatch");
  });
  it("requires a mask and private review variants for each specialist", () => {
    const withoutMask = result(); withoutMask.assets[0].diseases[0].mask_path = null;
    expect(() => validateResultV2(withoutMask, expected)).toThrow("private mask artifact");
    const withoutVariant = result(); delete withoutVariant.assets[0].review_paths.BLB;
    expect(() => validateResultV2(withoutVariant, expected)).toThrow("review variants");
  });
  it("accepts DJI XMP photo provenance and requires a linked photo for video GPS", () => {
    const photo = result(); photo.assets[0].location = { source: "dji_xmp", lat: 17.5, lng: 121.75 };
    expect(validateResultV2(photo, expected).assets[0].location.source).toBe("dji_xmp");
    const withVideo = result();
    withVideo.assets[0].location = { source: "exif", lat: 17.5, lng: 121.75 };
    withVideo.assets.push({
      ...withVideo.assets[0], source_asset_id: "clip", kind: "video", review_paths: { video: "survey/job/clip.mp4" },
      diseases: withVideo.assets[0].diseases.map((finding) => ({ ...finding, mask_path: "survey/job/frame_masks.zip" })),
      location: { source: "linked_photo", lat: 17.5, lng: 121.75, reference_asset_id: "photo" },
      frame_series: {
        clip_start_seconds: 104, clip_duration_seconds: 2 / 30, fps: 30, linked_photo_asset_id: "photo",
        mask_archive_path: "survey/job/frame_masks.zip", mask_archive_sha256: "a".repeat(64),
        review_video_sha256: "b".repeat(64), publication_video_sha256: "e".repeat(64),
        frames: [0, 1].map((index) => ({
          index, source_time_seconds: 104 + index / 30, source_sha256: String(index).repeat(64),
          mask_members: { BLB: `masks/frame_${String(index + 1).padStart(6, "0")}_blb.png`,
            "Brown Spot": `masks/frame_${String(index + 1).padStart(6, "0")}_brownspot.png` },
        })),
      },
    });
    withVideo.media.push({ source_asset_id: "clip", type: "video", variant: "video", path: "survey/job/clip.mp4", width: 1024, height: 1024, sanitized: true, alt: "Private clip", sha256: "b".repeat(64) });
    withVideo.media.push({ source_asset_id: "clip", type: "video", variant: "publication_candidate",
      path: "survey/job/publication.mp4", width: 1024, height: 1024, sanitized: true,
      alt: "Private publication candidate", sha256: "e".repeat(64) });
    const twoAssets = { ...expected, asset_ids: ["photo", "clip"], video_clips: {
      clip: { start_seconds: 104, duration_seconds: 2 / 30, fps: 30 as const, linked_photo_asset_id: "photo" },
    } };
    expect(validateResultV2(withVideo, twoAssets).assets).toHaveLength(2);
    withVideo.assets[1].location = { source: "linked_photo", lat: 17.5, lng: 121.75, reference_asset_id: "missing" };
    expect(() => validateResultV2(withVideo, twoAssets)).toThrow("verified source photo");
    withVideo.assets[1].location = { source: "linked_photo", lat: 17.6, lng: 121.75, reference_asset_id: "photo" };
    expect(() => validateResultV2(withVideo, twoAssets)).toThrow("verified source photo");
  });
  it("requires an independently masked receipt for every displayed video frame", () => {
    const withVideo = result();
    withVideo.assets.push({
      ...withVideo.assets[0], source_asset_id: "clip", kind: "video", review_paths: { video: "survey/job/clip.mp4" },
      diseases: withVideo.assets[0].diseases.map((finding) => ({ ...finding, mask_path: "survey/job/frame_masks.zip" })),
      location: { source: "missing", lat: null, lng: null },
      frame_series: {
        clip_start_seconds: 10, clip_duration_seconds: 2 / 30, fps: 30, linked_photo_asset_id: "photo",
        mask_archive_path: "survey/job/frame_masks.zip", mask_archive_sha256: "a".repeat(64),
        review_video_sha256: "b".repeat(64), publication_video_sha256: "e".repeat(64),
        frames: [0, 1].map((index) => ({ index, source_time_seconds: 10 + index / 30,
          source_sha256: String(index).repeat(64),
          mask_members: { BLB: `masks/frame_${String(index + 1).padStart(6, "0")}_blb.png`,
            "Brown Spot": `masks/frame_${String(index + 1).padStart(6, "0")}_brownspot.png` },
        })),
      },
    });
    withVideo.media.push({ source_asset_id: "clip", type: "video", variant: "video", path: "survey/job/clip.mp4", width: 1024, height: 1024, sanitized: true, alt: "Private clip", sha256: "b".repeat(64) });
    withVideo.media.push({ source_asset_id: "clip", type: "video", variant: "publication_candidate",
      path: "survey/job/publication.mp4", width: 1024, height: 1024, sanitized: true,
      alt: "Private publication candidate", sha256: "e".repeat(64) });
    const twoAssets = { ...expected, asset_ids: ["photo", "clip"], video_clips: {
      clip: { start_seconds: 10, duration_seconds: 2 / 30, fps: 30 as const, linked_photo_asset_id: "photo" },
    } };
    expect(validateResultV2(withVideo, twoAssets).assets).toHaveLength(2);
    withVideo.assets[1].frame_series!.frames[1].mask_members.BLB = withVideo.assets[1].frame_series!.frames[0].mask_members.BLB;
    expect(() => validateResultV2(withVideo, twoAssets)).toThrow("Invalid video frame receipt");
    withVideo.assets[1].frame_series!.frames.pop();
    expect(() => validateResultV2(withVideo, twoAssets)).toThrow("Every selected video frame");
  });
});
