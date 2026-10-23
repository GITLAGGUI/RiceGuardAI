"""Convert a verified private AWS photo result to the website's v2 review contract.

This module does not publish media, change a survey, or submit another job.
The caller must still verify the S3 objects and authenticate the worker callback.
"""

from __future__ import annotations

from copy import deepcopy
import re


DISEASES = ("BLB", "Brown Spot")
VARIANTS = ("original", "BLB", "Brown Spot", "combined")
BUNDLE_SHA256 = "98faa7b8541366bfd5751036f8111930fa3bb8cb2f0233d90c6c3d82e683a0da"
BASE = "website-inference/v2/jobs"


def _key(value: object, prefix: str) -> str:
    if not isinstance(value, str) or not value.startswith(prefix) or ".." in value or "?" in value or ":" in value:
        raise ValueError("Result contains an unauthorized private object key")
    return value


def _asset_id(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f-]{36}", value, re.IGNORECASE):
        raise ValueError("Invalid source asset identifier")
    return value


def pinned_bundle(bundle: dict) -> dict:
    if bundle.get("id") != "riceguard-yolo26m-semantic-20260928" or set(bundle.get("models", {})) != set(DISEASES):
        raise ValueError("Unexpected model bundle")
    models = {}
    for disease in DISEASES:
        spec = bundle["models"][disease]
        artifact = spec["sha256"]
        if not re.fullmatch(r"[0-9a-f]{64}", artifact) or spec["architecture"] != "yolo26m-semantic":
            raise ValueError("Unpinned model artifact")
        if spec["foreground_class_id"] != 1 or spec["input_size"] != 1024 or spec["stride"] != 768:
            raise ValueError("Model preprocessing mismatch")
        models[disease] = {
            "model_id": f"riceguard-{disease.lower().replace(' ', '-')}-yolo26m-semantic",
            "version": artifact[:16],
            "artifact_sha256": artifact,
            "foreground_class_id": 1,
            "input_size": 1024,
            "overlap": 0.25,
            "preprocessing": spec["preprocessing"],
        }
    return {
        "id": bundle["id"],
        "workflow_id": "aws-private-two-specialist-photo-v1",
        "workflow_sha256": BUNDLE_SHA256,
        "models": models,
    }


def to_result_v2(worker_result: dict, submitted_manifest: dict, bundle: dict) -> dict:
    """Build only complete, independently segmented photo findings.

    The manifest's `source_manifest_hash` is the Supabase job hash, distinct
    from the immutable AWS staging-manifest hash.
    """
    run_id = submitted_manifest.get("run_id")
    if (
        worker_result.get("schema") != "riceguard.aws.photo-worker.v1"
        or worker_result.get("status") != "needs_review"
        or worker_result.get("run_id") != run_id
        or worker_result.get("bundle_sha256") != BUNDLE_SHA256
        or submitted_manifest.get("kind") != "photo_batch"
        or not re.fullmatch(r"[0-9a-f]{64}", submitted_manifest.get("source_manifest_hash", ""))
        or not re.fullmatch(r"[0-9a-f]{64}", worker_result.get("source_manifest_sha256", ""))
    ):
        raise ValueError("AWS output does not match the submitted website run")
    source_assets = submitted_manifest.get("assets")
    outputs = worker_result.get("assets")
    if not isinstance(source_assets, list) or not isinstance(outputs, list) or len(source_assets) != len(outputs) or not 1 <= len(outputs) <= 4:
        raise ValueError("Missing or duplicate source assets")
    expected_ids = {_asset_id(item.get("id")) for item in source_assets}
    if len(expected_ids) != len(outputs) or {_asset_id(item.get("asset_id")) for item in outputs} != expected_ids:
        raise ValueError("AWS result omits or duplicates source assets")
    model_bundle = pinned_bundle(bundle)
    result_assets = []
    media = []
    prefix = f"{BASE}/{run_id}/outputs/{worker_result['source_manifest_sha256']}/"
    for asset in outputs:
        asset_id = asset["asset_id"]
        width, height = asset.get("width"), asset.get("height")
        if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0 or width * height > 60_000_000:
            raise ValueError("Invalid native photo dimensions")
        findings = asset.get("diseases")
        if not isinstance(findings, list) or len(findings) != 2 or {d.get("disease") for d in findings} != set(DISEASES):
            raise ValueError("Both specialist findings are required")
        diseases = []
        for finding in findings:
            disease = finding["disease"]
            pixels = finding.get("predicted_pixels")
            if not isinstance(pixels, int) or pixels < 0 or pixels > width * height or finding.get("status") != ("detected" if pixels else "not_detected"):
                raise ValueError("Invalid semantic-mask prediction")
            if finding.get("mask_meaning") != ("disease_region" if disease == "BLB" else "affected_leaf"):
                raise ValueError("Disease mask meaning mismatch")
            diseases.append({
                "disease": disease,
                "status": finding["status"],
                "predicted_pixels": pixels,
                "mask_meaning": finding["mask_meaning"],
                "mask_path": _key(finding.get("mask_path"), prefix),
                "review_decision": "pending",
                "quality_flags": [],
            })
        previews = asset.get("media")
        if not isinstance(previews, list) or len(previews) != 4 or {m.get("variant") for m in previews} != set(VARIANTS):
            raise ValueError("Four private native review variants are required")
        review_paths = {}
        for preview in previews:
            if preview.get("private") is not True or preview.get("sanitized") is not True or preview.get("width") != width or preview.get("height") != height:
                raise ValueError("Unsafe or resized review media")
            variant = preview["variant"]
            path = _key(preview.get("key"), prefix)
            review_paths[variant] = path
            media.append({"source_asset_id": asset_id, "type": "image", "variant": variant, "path": path,
                          "width": width, "height": height, "sanitized": True,
                          "alt": f"Private {variant} review image"})
        location = asset.get("location")
        if not isinstance(location, dict) or location.get("source") not in ("exif", "dji_xmp", "missing"):
            raise ValueError("Unverified photo location")
        lat, lng = location.get("lat"), location.get("lng")
        if location["source"] in ("exif", "dji_xmp"):
            if not all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in (lat, lng)) or abs(lat) > 90 or abs(lng) > 180:
                raise ValueError("Invalid EXIF coordinates")
        elif lat is not None or lng is not None:
            raise ValueError("Missing location cannot include coordinates")
        result_assets.append({
            "source_asset_id": asset_id,
            "kind": "image",
            "width": width,
            "height": height,
            "status": "complete",
            "diseases": diseases,
            "review_paths": review_paths,
            "location": deepcopy(location),
            "capture_time": asset.get("capture_time"),
            "quality_flags": list(asset.get("quality_flags") or []),
            "ambiguous_overlap_pixels": asset.get("overlap_pixels", 0),
        })
    return {
        "schema_version": "riceguard.result.v2",
        "run_id": run_id,
        "source_manifest_hash": submitted_manifest["source_manifest_hash"],
        "model_bundle": model_bundle,
        "assets": result_assets,
        "media": media,
        "severity": {"value": None, "method_version": None, "scope": "visible_leaf_area",
                     "availability_reason": "lesion_measurement_not_validated"},
        "warnings": ["AI-assisted candidates require staff review; no validated severity estimate."],
    }

