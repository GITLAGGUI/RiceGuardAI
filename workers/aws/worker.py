"""Private S3-backed, bounded photo worker. Not yet activated on the live website.

Manifests are submitted only by the authorized control plane. Partial failures
stay failures. Restarting the same immutable manifest reuses its tile caches.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import tempfile
import time

import boto3
from botocore.exceptions import ClientError
import numpy as np
from PIL import Image
import torch
from ultralytics import YOLO

from inference_core import DISEASES, inspect_image, overlay, stitch
from website_adapter import to_result_v2

BUCKET = "riceguard-l40s-78407276-20260824"
BASE = "website-inference/v2"
BUNDLE_HASH = "98faa7b8541366bfd5751036f8111930fa3bb8cb2f0233d90c6c3d82e683a0da"
MAX_SOURCE_BYTES = 200_000_000
s3 = boto3.client("s3")


def check_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", value):
        raise ValueError("Invalid identifier")
    return value


def read_bytes(key, limit):
    response = s3.get_object(Bucket=BUCKET, Key=key)
    if response["ContentLength"] > limit:
        response["Body"].close()
        raise ValueError("Object exceeds byte limit")
    return response["Body"].read()


def put_bytes(key, value, mime):
    s3.put_object(Bucket=BUCKET, Key=key, Body=value, ContentType=mime, ServerSideEncryption="AES256")


def put_json(key, value):
    put_bytes(key, json.dumps(value, sort_keys=True).encode(), "application/json")


def image_bytes(image, fmt="PNG"):
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **({"quality": 92} if fmt == "JPEG" else {}))
    return buffer.getvalue()


def run():
    started = time.monotonic()
    torch.set_num_threads(2)
    # Container self-limit, in addition to the AWS Batch job timeout.
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError("Worker runtime limit reached")))
    signal.alarm(1500)
    key = os.environ["RICEGUARD_MANIFEST_KEY"]
    if not re.fullmatch(BASE + r"/jobs/[a-zA-Z0-9_-]{1,80}/manifest\.json", key):
        raise ValueError("Manifest outside authorized namespace")
    raw = read_bytes(key, 1_000_000)
    manifest_hash = hashlib.sha256(raw).hexdigest()
    if manifest_hash != os.environ["RICEGUARD_MANIFEST_SHA256"]:
        raise ValueError("Immutable manifest hash mismatch")
    manifest = json.loads(raw)
    job = check_id(manifest["run_id"])
    if key != f"{BASE}/jobs/{job}/manifest.json":
        raise ValueError("Run/key mismatch")
    prefix = f"{BASE}/jobs/{job}/outputs/{manifest_hash}"
    if manifest.get("kind") != "photo_batch" or not 1 <= len(manifest.get("assets", [])) <= 4:
        raise ValueError("This gated worker supports 1-4 photos, not presentation videos yet")
    if len({a["id"] for a in manifest["assets"]}) != len(manifest["assets"]):
        raise ValueError("Duplicate assets")
    bundle_raw = read_bytes(f"{BASE}/bundles/{BUNDLE_HASH}.json", 100_000)
    if hashlib.sha256(bundle_raw).hexdigest() != BUNDLE_HASH:
        raise ValueError("Bundle hash mismatch")
    bundle = json.loads(bundle_raw)
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        models = {}
        for disease in DISEASES:
            spec = bundle["models"][disease]
            artifact = read_bytes(spec["key"], 100_000_000)
            if hashlib.sha256(artifact).hexdigest() != spec["sha256"]:
                raise ValueError("Model hash mismatch")
            local = work / f"{spec['sha256']}.pt"
            local.write_bytes(artifact)
            model = YOLO(str(local))
            expected_name = "Bacterial Leaf Blight" if disease == "BLB" else "Brown Spot"
            if model.task != "semantic" or model.names.get(1) != expected_name:
                raise ValueError("Model class mapping mismatch")
            models[disease] = model
        for asset in manifest["assets"]:
            asset_id = check_id(asset["id"])
            source_key = asset["key"]
            if not source_key.startswith(f"{BASE}/jobs/{job}/inputs/") or ".." in source_key:
                raise ValueError("Source outside run namespace")
            source = read_bytes(source_key, MAX_SOURCE_BYTES)
            source_hash = hashlib.sha256(source).hexdigest()
            if source_hash != asset["sha256"]:
                raise ValueError("Source checksum mismatch")
            local = work / asset_id
            local.write_bytes(source)
            del source
            image, metadata = inspect_image(local)
            masks = {}
            findings = []
            for disease in DISEASES:
                cache_prefix = f"{prefix}/cache/{asset_id}/{disease.replace(' ', '-')}/{source_hash}"

                def get_cache(index, shape):
                    cache_key = f"{cache_prefix}/{index}.png"
                    # Missing GetObject can return 403 when ListBucket is scoped.
                    # List only this exact cache prefix; never treat AccessDenied
                    # as a healthy/empty model result or an authorized cache miss.
                    objects = s3.list_objects_v2(Bucket=BUCKET, Prefix=cache_key, MaxKeys=1).get("Contents", [])
                    if not objects or objects[0]["Key"] != cache_key:
                        return None
                    data = read_bytes(cache_key, 2_000_000)
                    with Image.open(io.BytesIO(data)) as cached:
                        return np.asarray(cached) == 255

                def put_cache(index, mask):
                    put_bytes(f"{cache_prefix}/{index}.png", image_bytes(Image.fromarray(mask.astype(np.uint8) * 255)), "image/png")

                def progress(done, total):
                    if done % 8 == 0 or done == total:
                        put_json(f"{prefix}/progress.json", {"stage": "inference", "asset": asset_id,
                            "disease": disease, "tiles_done": done, "tiles_total": total})

                def predict(tile):
                    result = models[disease].predict(tile, imgsz=1024, device="cpu", verbose=False)[0]
                    if result.semantic_mask is None:
                        raise RuntimeError("Missing model prediction")
                    return result.semantic_mask.data.detach().cpu().numpy()

                masks[disease] = stitch(image, predict, get_cache, put_cache, progress)
                mask_key = f"{prefix}/{asset_id}/{disease.replace(' ', '-')}.png"
                put_bytes(mask_key, image_bytes(Image.fromarray(masks[disease].astype(np.uint8) * 255)), "image/png")
                count = int(masks[disease].sum())
                findings.append({"disease": disease, "status": "detected" if count else "not_detected",
                    "predicted_pixels": count, "mask_path": mask_key,
                    "mask_meaning": bundle["models"][disease]["mask_meaning"], "review_decision": "pending"})
            media = []
            for variant in ("original", "BLB", "Brown Spot", "combined"):
                picture = image if variant == "original" else overlay(image, masks if variant == "combined" else {variant: masks[variant]})
                output_key = f"{prefix}/{asset_id}/{variant.replace(' ', '-')}.jpg"
                put_bytes(output_key, image_bytes(picture, "JPEG"), "image/jpeg")
                media.append({"variant": variant, "key": output_key, "width": image.width,
                              "height": image.height, "private": True, "sanitized": True})
            results.append({"asset_id": asset_id, "status": "complete", "width": image.width, "height": image.height,
                **metadata, "diseases": findings, "media": media,
                "overlap_pixels": int((masks["BLB"] & masks["Brown Spot"]).sum()), "severity": None})
            put_json(f"{prefix}/checkpoint.json", {"assets": results, "needs_staff_review": True})
    private_result = {"schema": "riceguard.aws.photo-worker.v1", "run_id": job,
        "source_manifest_sha256": manifest_hash, "bundle_sha256": BUNDLE_HASH,
        "assets": results, "seconds": round(time.monotonic() - started, 2), "status": "needs_review",
        "website_activation": False, "severity_unavailable_reason": "lesion_measurement_not_validated"}
    put_json(f"{prefix}/result.json", private_result)
    if manifest.get("source_manifest_hash"):
        # Only website-staged manifests receive the separately validated v2
        # contract. This is still private S3 data, not a publication event.
        put_json(f"{prefix}/website-result.json", to_result_v2(private_result, manifest, bundle))
    print(json.dumps({"status": "needs_review", "result_key": f"{prefix}/result.json"}), flush=True)


if __name__ == "__main__":
    run()
