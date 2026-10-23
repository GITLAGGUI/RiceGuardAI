"""Build private image-derivative catalogue and upload plan from local artifacts.

No upload occurs here. Videos are explicitly excluded: image_index counts only
photos, retaining their manifest order. The original manifest and native files
are never changed. All photo receipts/files/decodes pass before output is made.
"""

from pathlib import Path
import re
from uuid import UUID

from .derivatives import (
    MAX_SOURCE_BYTES,
    _load_rgb,
    _new_output,
    _read_verified,
    _reject_links,
    build_derivatives,
)


SCHEMA_VERSION = "riceguard.advisory.catalogue.v1"
POLICY_VERSION = "visual-v1"
VARIANTS = ("original", "combined")


def _uuid(value: str, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a UUID")
    try:
        return str(UUID(value))
    except ValueError as error:
        raise ValueError(f"{label} must be a UUID") from error


def _object_key(value: str, prefix: str) -> str:
    if not isinstance(value, str) or not value.startswith(prefix):
        raise ValueError("photo path must be within the exact native run output prefix")
    # Object keys are never URLs or local filesystem paths. Restrict each segment
    # to literal ASCII names so encoded traversal and separator ambiguity fail.
    parts = value.split("/")
    if any(part in (".", "..") or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", part) for part in parts):
        raise ValueError("photo artifact path is not a safe canonical object key")
    return value


def _preflight(result_manifest: dict, local_artifacts: dict[str, Path]) -> tuple[str, list[dict]]:
    if not isinstance(result_manifest, dict) or result_manifest.get("schema_version") != "riceguard.result.v2":
        raise ValueError("native riceguard.result.v2 manifest required")
    run_id = result_manifest.get("run_id")
    if not isinstance(run_id, str) or not re.fullmatch(r"rg-[a-z0-9-]{8,80}", run_id):
        raise ValueError("invalid native run_id")
    artifacts, assets = result_manifest.get("artifacts"), result_manifest.get("assets")
    if not isinstance(artifacts, dict) or not isinstance(assets, list) or not isinstance(local_artifacts, dict):
        raise ValueError("native artifacts, assets and exact local artifact mapping required")
    photos = []
    ids = set()
    for asset in assets:
        if not isinstance(asset, dict) or asset.get("kind") not in ("image", "video"):
            raise ValueError("result assets must be images or explicitly excluded videos")
        if asset["kind"] == "video":
            continue
        asset_id = _uuid(asset.get("source_asset_id"), "source_asset_id")
        if asset_id in ids:
            raise ValueError("duplicate photo source_asset_id")
        ids.add(asset_id)
        if asset.get("status") != "complete":
            raise ValueError("photo must have complete native result status")
        paths = asset.get("review_paths")
        if not isinstance(paths, dict):
            raise ValueError("photo original and combined review paths required")
        photos.append({"source_asset_id": asset_id, "review_paths": paths})
    if not 1 <= len(photos) <= 10:
        raise ValueError("catalogue requires between 1 and 10 photos")

    prefix = f"website-inference/v2/jobs/{run_id}/outputs/"
    prepared = []
    for image_index, photo in enumerate(photos, start=1):
        for variant in VARIANTS:
            key = _object_key(photo["review_paths"].get(variant), prefix)
            receipt = artifacts.get(key)
            if not isinstance(receipt, dict):
                raise ValueError("exact photo artifact receipt is missing")
            digest, byte_count = receipt.get("sha256"), receipt.get("bytes")
            if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
                raise ValueError("photo artifact receipt needs a valid SHA256")
            if type(byte_count) is not int or not 0 < byte_count <= MAX_SOURCE_BYTES:
                raise ValueError("photo artifact receipt has invalid byte count")
            source = local_artifacts.get(key)
            if not isinstance(source, Path):
                raise ValueError("exact local photo artifact Path is missing")
            blob = _read_verified(source, digest)
            if len(blob) != byte_count:
                raise ValueError("local source byte count does not match native receipt")
            with _load_rgb(blob):
                pass
            prepared.append({"source_asset_id": photo["source_asset_id"], "image_index": image_index,
                             "variant": variant, "source_sha256": digest, "source": source})
    return run_id, prepared


def build_catalogue(result_manifest: dict, local_artifacts: dict[str, Path], output_root: Path, *,
                    survey_id: str, job_id: str, result_revision: int) -> tuple[dict, dict[str, Path]]:
    """Return a complete catalogue plus target-object-key -> new-local-file plan.

    The output root must not exist and its parent must already exist. Sources are
    reverified by build_derivatives before each encode. If a later runtime error
    occurs, no catalogue is returned; partial new output is left for inspection
    and must never be treated as a ready catalogue.
    """
    survey_id, job_id = _uuid(survey_id, "survey_id"), _uuid(job_id, "job_id")
    if type(result_revision) is not int or result_revision < 1:
        raise ValueError("result_revision must be a positive integer")
    output_root = _new_output(output_root)
    run_id, prepared = _preflight(result_manifest, local_artifacts)
    _reject_links(output_root)
    output_root.mkdir()
    entries, uploads = [], {}
    for item in prepared:
        asset_id, variant = item["source_asset_id"], item["variant"]
        asset_root = output_root / asset_id
        asset_root.mkdir(exist_ok=True)
        variant_root = asset_root / variant
        derivative = build_derivatives(item["source"], variant_root,
                                       source_sha256=item["source_sha256"],
                                       source_asset_id=asset_id, variant=variant)
        overview = derivative["overview"]
        target = f"website-inference/v2/jobs/{run_id}/outputs/advisory-media/{POLICY_VERSION}/{asset_id}/{variant}.jpg"
        entries.append({"source_asset_id": asset_id, "image_index": item["image_index"], "variant": variant,
                        "source_sha256": item["source_sha256"], "path": target,
                        **{key: overview[key] for key in ("sha256", "bytes", "width", "height", "quality")}})
        uploads[target] = variant_root / overview["file"]
    return {"schema_version": SCHEMA_VERSION, "policy_version": POLICY_VERSION,
            "survey_id": survey_id, "job_id": job_id, "result_revision": result_revision,
            "entries": entries}, uploads
