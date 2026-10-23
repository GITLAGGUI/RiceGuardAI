"""Stage a private dual-specialist photo/video result-v2 manifest.

The returned upload map identifies local files for a separately authenticated
private object-store transfer. Building this manifest never uploads or publishes.
"""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

from .prepare_clip import digest


DISEASES = ("BLB", "Brown Spot")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
SHA = re.compile(r"^[0-9a-f]{64}$")
RUN = re.compile(r"^[a-zA-Z0-9_-]{1,80}$")
VARIANTS = ("original", "BLB", "Brown Spot", "combined")
# Web-sized public candidates: (variant, file suffix, media type label).
WEB_VARIANTS = (("web_original", "jpg"), ("web_combined", "jpg"), ("layer_BLB", "png"), ("layer_Brown Spot", "png"))
MASK_MEANING = "lesion_area"
BUNDLE_SHA256 = "0cdd9ec7c4846f5bf8c15449081bef38be1379da715f04240aab68161add86fd"
BUNDLE_ID = "riceguard-b10unet-yolo26l-20261023"
ARCHITECTURES = {"BLB": "unet-convnext-b-dinov3", "Brown Spot": "yolo26l-semantic"}
WORKFLOW_FILES = {
    "prepare_clip.py": "workers/kaggle/prepare_clip.py",
    "pinned_video_core.py": "workers/kaggle/pinned_video_core.py",
    "pinned_photo_core.py": "workers/kaggle/pinned_photo_core.py",
    "website_adapter.py": "workers/kaggle/website_adapter.py",
    "private_upload.py": "workers/kaggle/private_upload.py",
    "website_runner.py": "workers/kaggle/website_runner.py",
    "aws_website_adapter.py": "workers/aws/website_adapter.py",
    "aws_inference_core.py": "workers/aws/inference_core.py",
    "specialists.py": "workers/kaggle/specialists.py",
    "severity.py": "workers/kaggle/severity.py",
}


def pinned_bundle(bundle: dict) -> dict:
    if bundle.get("id") != BUNDLE_ID or set(bundle.get("models", {})) != set(DISEASES):
        raise ValueError("Unexpected model bundle")
    models = {}
    for disease in DISEASES:
        spec = bundle["models"][disease]
        artifact = spec["sha256"]
        if not SHA.fullmatch(artifact) or spec["architecture"] != ARCHITECTURES[disease]:
            raise ValueError("Unpinned model artifact")
        if spec["foreground_class_id"] != 1 or spec["input_size"] != 1024 or spec["stride"] != 768:
            raise ValueError("Model preprocessing mismatch")
        models[disease] = {
            "model_id": f"riceguard-{disease.lower().replace(' ', '-')}-{spec['architecture']}",
            "version": artifact[:16],
            "artifact_sha256": artifact,
            "foreground_class_id": 1,
            "input_size": 1024,
            "overlap": 0.25,
            "preprocessing": spec["preprocessing"],
        }
    return {"id": bundle["id"], "workflow_id": "kaggle-private-two-specialist-media-v1",
            "workflow_sha256": BUNDLE_SHA256, "models": models}


def _measurements(value: object, width: int, height: int) -> dict:
    if not isinstance(value, dict):
        raise ValueError("Invalid severity pixel measurements")
    lesions, plant = value.get("lesion_pixels"), value.get("plant_pixels")
    if (value.get("method") != "exg_otsu_hsv_v1" or value.get("frame_pixels") != width * height or
            not isinstance(plant, int) or not 0 <= plant <= width * height or
            not isinstance(lesions, dict) or set(lesions) != set(DISEASES) or
            any(not isinstance(n, int) or not 0 <= n <= plant for n in lesions.values())):
        raise ValueError("Invalid severity pixel measurements")
    return {"method": value["method"], "frame_pixels": width * height, "plant_pixels": plant,
            "lesion_pixels": {disease: lesions[disease] for disease in DISEASES}}


def _local(root: Path, name: str) -> Path:
    if not isinstance(name, str) or name.startswith("/") or "\\" in name or ".." in Path(name).parts:
        raise ValueError("Unsafe local result path")
    path = (root / name).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("Missing private result artifact")
    return path


def workflow_hash(bundle_hash: str, code_hashes: dict[str, str]) -> str:
    if not SHA.fullmatch(bundle_hash) or set(code_hashes) != set(WORKFLOW_FILES) or any(
        not SHA.fullmatch(value) for value in code_hashes.values()
    ):
        raise ValueError("Incomplete pinned workflow provenance")
    descriptor = {"bundle_sha256": bundle_hash, "code_sha256": code_hashes,
                  "fps": 30, "tile": 1024, "stride": 768,
                  "scope": "one-to-ten-photos-plus-one-optional-video"}
    return hashlib.sha256(json.dumps(descriptor, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def local_code_hashes(root: Path | None = None) -> dict[str, str]:
    """Hash the actual worker source, not caller-supplied notebook metadata."""
    repository_root = root or Path(__file__).resolve().parents[2]
    return {name: digest(_local(repository_root, relative)) for name, relative in WORKFLOW_FILES.items()}


def build_result_v2(submitted_manifest: dict, bundle: dict, code_hashes: dict[str, str],
                    photo_receipts: list[dict], photos_root: Path,
                    video_summary: dict | None, video_receipts: list[dict] | None,
                    video_root: Path | None, video_input_manifest: dict | None,
                    private_prefix: str) -> tuple[dict, dict[str, Path]]:
    run_id = submitted_manifest.get("run_id")
    source_hash = submitted_manifest.get("source_manifest_hash")
    if (submitted_manifest.get("kind") != "pinned_media_batch" or not isinstance(run_id, str) or
            not RUN.fullmatch(run_id) or not isinstance(source_hash, str) or not SHA.fullmatch(source_hash) or
            private_prefix != f"website-inference/v2/jobs/{run_id}/outputs/{source_hash}/"):
        raise ValueError("Result namespace does not match the immutable website job")
    source_assets = submitted_manifest.get("assets")
    if not isinstance(source_assets, list) or not 1 <= len(source_assets) <= 11:
        raise ValueError("Missing authorized source assets")
    source_by_id = {asset.get("id"): asset for asset in source_assets}
    if len(source_by_id) != len(source_assets) or any(not isinstance(asset_id, str) or not UUID.fullmatch(asset_id)
                                                for asset_id in source_by_id):
        raise ValueError("Duplicate or invalid source asset IDs")
    photos = [asset for asset in source_assets if asset.get("mime") in ("image/jpeg", "image/png")]
    videos = [asset for asset in source_assets if asset.get("mime") == "video/mp4"]
    if not 1 <= len(photos) <= 10 or len(videos) > 1 or len(photos) + len(videos) != len(source_assets):
        raise ValueError("Unsupported source media combination")
    if len(photo_receipts) != len(photos) or {item.get("source_asset_id") for item in photo_receipts} != {item["id"] for item in photos}:
        raise ValueError("Photo results are incomplete")

    if hashlib.sha256(json.dumps(bundle, sort_keys=True, indent=2).encode()).hexdigest() != BUNDLE_SHA256:
        raise ValueError("Private model bundle bytes changed")
    if code_hashes != local_code_hashes():
        raise ValueError("Pinned worker source changed during result creation")
    pinned = pinned_bundle(bundle)
    pinned["workflow_id"] = "kaggle-private-two-specialist-media-v1"
    pinned["workflow_sha256"] = workflow_hash(BUNDLE_SHA256, code_hashes)
    uploads: dict[str, Path] = {}
    results = []
    media = []
    locations = {}
    for receipt in photo_receipts:
        asset_id = receipt["source_asset_id"]
        source = source_by_id[asset_id]
        width, height = receipt.get("width"), receipt.get("height")
        if (receipt.get("source_sha256") != source.get("sha256") or receipt.get("status") != "complete" or
                not isinstance(width, int) or not isinstance(height, int) or
                (width, height) != (source.get("width"), source.get("height"))):
            raise ValueError("Native photo result does not match its source")
        findings = receipt.get("diseases")
        if not isinstance(findings, list) or {item.get("disease") for item in findings} != set(DISEASES):
            raise ValueError("Both photo specialists must finish")
        diseases = []
        for item in findings:
            disease = item["disease"]
            pixels = item.get("predicted_pixels")
            if (not isinstance(pixels, int) or not 0 <= pixels <= width * height or
                    item.get("status") != ("detected" if pixels else "not_detected") or
                    item.get("mask_meaning") != MASK_MEANING):
                raise ValueError("Invalid independent photo mask")
            local = _local(photos_root, item.get("mask_path"))
            key = private_prefix + f"photos/{asset_id}/{disease.lower().replace(' ', '-')}.png"
            uploads[key] = local
            diseases.append({"disease": disease, "status": item["status"], "predicted_pixels": pixels,
                             "mask_meaning": item["mask_meaning"], "mask_path": key,
                             "review_decision": "pending", "quality_flags": []})
        review_paths = {}
        for variant in VARIANTS:
            local = _local(photos_root, receipt["review_paths"].get(variant))
            key = private_prefix + f"photos/{asset_id}/{variant.lower().replace(' ', '-')}.jpg"
            uploads[key] = local
            review_paths[variant] = key
            media.append({"source_asset_id": asset_id, "type": "image", "variant": variant,
                          "path": key, "width": width, "height": height, "sanitized": True,
                          "alt": f"Private {variant} review image"})
        web_width, web_height = receipt.get("web_width"), receipt.get("web_height")
        if (not isinstance(web_width, int) or not isinstance(web_height, int) or
                not 0 < web_width <= width or not 0 < web_height <= height or max(web_width, web_height) > 2048):
            raise ValueError("Invalid web-sized derivative dimensions")
        for variant, suffix in WEB_VARIANTS:
            local = _local(photos_root, receipt["review_paths"].get(variant))
            key = private_prefix + f"photos/{asset_id}/{variant.lower().replace(' ', '-').replace('_', '-')}.{suffix}"
            uploads[key] = local
            review_paths[variant] = key
            media.append({"source_asset_id": asset_id, "type": "image", "variant": variant,
                          "path": key, "width": web_width, "height": web_height, "sanitized": True,
                          "alt": f"Web {variant.replace('_', ' ')}"})
        location = receipt.get("location")
        if not isinstance(location, dict) or location.get("source") not in ("exif", "dji_xmp", "missing"):
            raise ValueError("Unverified photo location")
        locations[asset_id] = deepcopy(location)
        results.append({"source_asset_id": asset_id, "kind": "image", "width": width, "height": height,
                        "status": "complete", "diseases": diseases, "review_paths": review_paths,
                        "location": deepcopy(location), "capture_time": receipt.get("capture_time"),
                        "quality_flags": list(receipt.get("quality_flags") or []),
                        "measurements": _measurements(receipt.get("measurements"), width, height),
                        "ambiguous_overlap_pixels": receipt.get("ambiguous_overlap_pixels", 0)})

    if videos:
        source = videos[0]
        asset_id = source["id"]
        if not video_summary or not video_receipts or not video_root or not video_input_manifest:
            raise ValueError("The selected video has no complete private result")
        width, height = source.get("width"), source.get("height")
        expected_count = round(source["clip_duration_seconds"] * 30)
        reference = source.get("linked_photo_asset_id")
        if (video_input_manifest.get("source_sha256") != source.get("sha256") or
                video_input_manifest.get("linked_photo_asset_id") != reference or
                video_summary.get("status") != "needs_review" or
                video_summary.get("private_review_only") is not True or
                video_summary.get("frames") != expected_count or len(video_receipts) != expected_count or
                len(video_input_manifest.get("frames", [])) != expected_count or
                video_summary.get("dimensions") != [width, height] or
                video_summary.get("clip_start_seconds") != source.get("clip_start_seconds") or
                video_summary.get("clip_duration_seconds") != source.get("clip_duration_seconds") or
                video_summary.get("fps") != 30 or reference not in locations or
                video_summary.get("model_hashes") != {disease: pinned["models"][disease]["artifact_sha256"] for disease in DISEASES}):
            raise ValueError("Video output does not match its pinned source and model bundle")
        archive = _local(video_root, video_summary.get("mask_archive"))
        mp4 = _local(video_root, video_summary.get("video"))
        publication = _local(video_root, video_summary.get("publication_candidate"))
        if (digest(archive) != video_summary.get("mask_archive_sha256") or
                digest(mp4) != video_summary.get("video_sha256") or
                digest(publication) != video_summary.get("publication_candidate_sha256") or
                publication.stat().st_size > 52_428_800):
            raise ValueError("Private video artifact checksum mismatch")
        archive_key = private_prefix + f"video/{asset_id}/frame_masks.zip"
        video_key = private_prefix + f"video/{asset_id}/review.mp4"
        uploads[archive_key] = archive
        uploads[video_key] = mp4
        publication_key = private_prefix + f"video/{asset_id}/publication_candidate.mp4"
        uploads[publication_key] = publication
        frames = []
        pixels = {disease: 0 for disease in DISEASES}
        for index, item in enumerate(video_receipts):
            members = item.get("mask_paths") or {}
            if (item.get("index") != index or
                    abs(item.get("source_time_seconds", -1) - (source["clip_start_seconds"] + index / 30)) > 0.001 or
                    item.get("source_sha256") != video_input_manifest["frames"][index]["sha256"] or
                    any(members.get(disease) != f"masks/frame_{index + 1:06d}_{'blb' if disease == 'BLB' else 'brownspot'}.png"
                        for disease in DISEASES)):
                raise ValueError("Video frame masks are incomplete or misaligned")
            frames.append({"index": index, "source_time_seconds": item["source_time_seconds"],
                           "source_sha256": item["source_sha256"], "mask_members": members})
            for disease in DISEASES:
                count = item["predicted_pixels"][disease]
                if not isinstance(count, int) or not 0 <= count <= width * height:
                    raise ValueError("Invalid per-frame specialist result")
                pixels[disease] += count
        photo_location = locations[reference]
        linked_location = ({"source": "linked_photo", "lat": photo_location["lat"], "lng": photo_location["lng"],
                            "reference_asset_id": reference} if photo_location["source"] != "missing"
                           else {"source": "missing", "lat": None, "lng": None})
        results.append({"source_asset_id": asset_id, "kind": "video", "width": width, "height": height,
                        "status": "complete", "diseases": [
                            {"disease": disease, "status": "detected" if pixels[disease] else "not_detected",
                             "predicted_pixels": pixels[disease],
                             "mask_meaning": MASK_MEANING,
                             "mask_path": archive_key, "review_decision": "pending", "quality_flags": []}
                            for disease in DISEASES],
                        "review_paths": {"video": video_key}, "location": linked_location,
                        "capture_time": None, "quality_flags": [], "ambiguous_overlap_pixels": 0,
                        "frame_series": {"clip_start_seconds": source["clip_start_seconds"],
                                         "clip_duration_seconds": source["clip_duration_seconds"], "fps": 30,
                                         "linked_photo_asset_id": reference,
                                         "mask_archive_path": archive_key,
                                         "mask_archive_sha256": video_summary["mask_archive_sha256"],
                                         "review_video_sha256": video_summary["video_sha256"],
                                         "publication_video_sha256": video_summary["publication_candidate_sha256"],
                                         "frames": frames}})
        media.append({"source_asset_id": asset_id, "type": "video", "variant": "video",
                      "path": video_key, "width": width, "height": height, "sanitized": True,
                      "alt": "Private native-resolution review video", "sha256": video_summary["video_sha256"]})
        media.append({"source_asset_id": asset_id, "type": "video", "variant": "publication_candidate",
                      "path": publication_key, "width": width, "height": height, "sanitized": True,
                      "alt": "Private native-resolution publication candidate",
                      "sha256": video_summary["publication_candidate_sha256"]})
    elif video_summary or video_receipts or video_root or video_input_manifest:
        raise ValueError("Unexpected video output for a photo-only job")

    artifacts = {key: {"sha256": digest(path), "bytes": path.stat().st_size}
                 for key, path in uploads.items()}
    return ({"schema_version": "riceguard.result.v2", "run_id": run_id,
             "source_manifest_hash": source_hash, "model_bundle": pinned, "assets": results, "media": media,
             "artifacts": artifacts,
             "severity": {"value": None, "method_version": None, "scope": "visible_leaf_area",
                          "availability_reason": "lesion_measurement_not_validated"},
             "warnings": ["Automated findings; a specialist may still accept or reject each one."]}, uploads)

