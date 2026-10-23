"""Private native-size photo inference using the same pinned semantic specialists.

Inputs are already verified Drive originals. Outputs are review candidates only;
this module neither uploads, publishes nor computes disease severity.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

import numpy as np
from PIL import Image

from workers.aws.inference_core import DISEASES, inspect_image, overlay
from .pinned_video_core import stitch


UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
MAX_SOURCE_BYTES = 200_000_000
MAX_PHOTOS = 10


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run_photos(sources: list[dict], models: dict, output_dir: Path) -> list[dict]:
    if not 1 <= len(sources) <= MAX_PHOTOS or set(models) != set(DISEASES):
        raise ValueError("One to ten photos and both pinned specialists are required")
    if output_dir.exists():
        raise FileExistsError("Private photo results already exist; no output was overwritten")
    output_dir.mkdir(parents=True)
    receipts = []
    for source in sources:
        asset_id = source.get("id")
        path = Path(source.get("path", ""))
        expected_hash = source.get("sha256")
        if (not isinstance(asset_id, str) or not UUID.fullmatch(asset_id) or not path.is_file() or
                path.stat().st_size > MAX_SOURCE_BYTES or not isinstance(expected_hash, str) or
                not re.fullmatch(r"[0-9a-f]{64}", expected_hash) or digest(path) != expected_hash):
            raise ValueError("Unverified photo source")
        image, metadata = inspect_image(path)
        masks = {disease: stitch(image, model) for disease, model in models.items()}
        asset_dir = output_dir / asset_id
        asset_dir.mkdir()
        diseases = []
        for disease, mask in masks.items():
            mask_path = asset_dir / f"{disease.lower().replace(' ', '-')}.png"
            Image.fromarray(mask.astype(np.uint8) * 255).save(mask_path)
            pixels = int(mask.sum())
            diseases.append({"disease": disease, "status": "detected" if pixels else "not_detected",
                             "predicted_pixels": pixels, "mask_path": mask_path.relative_to(output_dir).as_posix(),
                             "mask_meaning": "disease_region" if disease == "BLB" else "affected_leaf",
                             "review_decision": "pending"})
        review_paths = {}
        for variant in ("original", "BLB", "Brown Spot", "combined"):
            picture = image if variant == "original" else overlay(
                image, masks if variant == "combined" else {variant: masks[variant]})
            out = asset_dir / f"{variant.lower().replace(' ', '-')}.jpg"
            # Saving a new RGB pixel image drops source EXIF, DJI GPS and XMP.
            picture.save(out, "JPEG", quality=92)
            with Image.open(out) as encoded:
                if encoded.size != image.size or encoded.getexif():
                    raise RuntimeError("Native review derivative retained sensitive metadata")
            review_paths[variant] = out.relative_to(output_dir).as_posix()
        receipts.append({"source_asset_id": asset_id, "kind": "image", "status": "complete",
                         "source_sha256": expected_hash, "width": image.width, "height": image.height,
                         **metadata, "diseases": diseases, "review_paths": review_paths,
                         "ambiguous_overlap_pixels": int((masks["BLB"] & masks["Brown Spot"]).sum()),
                         "severity": None})
    (output_dir / "photo_receipts.json").write_text(json.dumps(receipts, indent=2), encoding="utf-8")
    return receipts

