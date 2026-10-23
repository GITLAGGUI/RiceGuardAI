import { describe, expect, it } from "vitest";
import { validateMediaSelection, validateVideoClipSelection, type SourceAsset } from "../../../supabase/functions/_shared/mediaSelection";

const photo = (id = "photo"): SourceAsset => ({
  id, mime: "image/jpeg", bytes: 20_000_000, width: 8064, height: 4536, state: "Verified",
});
const video = (): SourceAsset => ({
  id: "video", mime: "video/mp4", bytes: 250_000_000, width: 3840, height: 2160,
  duration_seconds: 180, clip_start_seconds: 104, clip_duration_seconds: 30,
  clip_target_fps: 30, linked_photo_asset_id: "photo", state: "Verified",
});

describe("private source selection", () => {
  it("accepts the existing bounded AWS photo path", () => {
    expect(validateMediaSelection([photo()], "aws").video).toBeNull();
    expect(() => validateMediaSelection([photo(), video()], "aws")).toThrow("cannot process video");
  });
  it("accepts a 30-second 30-FPS video linked to a same-survey photo", () => {
    expect(validateMediaSelection([photo(), video()], "kaggle_yolo26").video?.linked_photo_asset_id).toBe("photo");
  });
  it("accepts ten native photos and one linked presentation video", () => {
    const photos = Array.from({ length: 10 }, (_, index) => photo(index === 0 ? "photo" : `photo-${index + 1}`));
    const selected = validateMediaSelection([...photos, video()], "kaggle_yolo26");
    expect(selected.photos).toHaveLength(10);
    expect(selected.video?.id).toBe("video");
  });
  it("rejects the earlier 31-second QA interval for website upload", () => {
    expect(() => validateMediaSelection([photo(), { ...video(), clip_duration_seconds: 31 }], "kaggle_yolo26"))
      .toThrow("at most 30 seconds");
  });
  it("requires clip timestamps to align to the requested 30 FPS output", () => {
    expect(validateVideoClipSelection(180, 104, 30, 30).frame_count).toBe(900);
    expect(() => validateVideoClipSelection(180, 104, 1.01, 30)).toThrow("align");
    expect(() => validateVideoClipSelection(180, null as unknown as number, 30, 30)).toThrow("source-bounded");
  });
  it("rejects missing or cross-survey photo references and unsupported frame rates", () => {
    expect(() => validateMediaSelection([photo(), { ...video(), linked_photo_asset_id: "other" }], "kaggle_yolo26"))
      .toThrow("same survey");
    expect(() => validateMediaSelection([photo(), { ...video(), clip_target_fps: 5 }], "kaggle_yolo26"))
      .toThrow("30 FPS");
  });
  it("rejects incomplete, duplicated, and excessive sources", () => {
    expect(() => validateMediaSelection([{ ...photo(), state: "Uploading" }], "aws")).toThrow("verified");
    expect(() => validateMediaSelection([photo(), photo()], "aws")).toThrow("Duplicate");
    expect(() => validateMediaSelection([photo(), video(), { ...video(), id: "video2" }], "kaggle_yolo26"))
      .toThrow("one optional MP4");
    expect(() => validateMediaSelection(Array.from({ length: 11 }, (_, index) => photo(`photo-${index}`)), "kaggle_yolo26"))
      .toThrow("one to ten");
  });
});
