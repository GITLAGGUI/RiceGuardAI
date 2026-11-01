"""Private native-size photo inference with the two pinned lesion specialists.

Inputs are already verified Drive originals. Outputs are full-resolution private review
images, web-sized public candidates (original, combined and one transparent layer per
disease) and pixel measurements for automated severity. Nothing here uploads or publishes.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re

import numpy as np
from PIL import Image

from workers.aws.inference_core import DISEASES, disease_layer, inspect_image, overlay, web_size
from .severity import measure
from .specialists import stitch


UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
MAX_SOURCE_BYTES = 200_000_000
MAX_PHOTOS = 10
MASK_MEANING = "lesion_area"
REVIEW_VARIANTS = ("original", "BLB", "Brown Spot", "combined")
WEB_VARIANTS = ("web_original", "web_combined", "layer_BLB", "layer_Brown Spot")


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def slug(name: str) -> str:
    return name.lower().replace(" ", "-").replace("_", "-")


def save_clean_jpeg(picture: Image.Image, out: Path, quality: int) -> None:
    # Saving a new RGB pixel image drops source EXIF, DJI GPS and XMP.
    picture.save(out, "JPEG", quality=quality, optimize=True)
    with Image.open(out) as encoded:
        if encoded.size != picture.size or encoded.getexif():
            raise RuntimeError("Review derivative retained sensitive metadata")


def _write_outputs(asset_id: str, expected_hash: str, image: Image.Image, metadata: dict,
                   masks: dict, output_dir: Path) -> dict:
    """Encode every private and web derivative for one photo (CPU only)."""
    asset_dir = output_dir / asset_id
    asset_dir.mkdir()
    diseases = []
    jobs = []
    for disease, mask in masks.items():
        mask_path = asset_dir / f"{slug(disease)}.png"
        jobs.append(lambda mask=mask, mask_path=mask_path:
                    Image.fromarray(mask.astype(np.uint8) * 255).save(mask_path, optimize=True))
        pixels = int(mask.sum())
        diseases.append({"disease": disease, "status": "detected" if pixels else "not_detected",
                         "predicted_pixels": pixels, "mask_path": mask_path.relative_to(output_dir).as_posix(),
                         "mask_meaning": MASK_MEANING, "review_decision": "pending"})
    review_paths = {}
    for variant in REVIEW_VARIANTS:
        out = asset_dir / f"{slug(variant)}.jpg"
        jobs.append(lambda variant=variant, out=out: save_clean_jpeg(image if variant == "original" else overlay(
            image, masks if variant == "combined" else {variant: masks[variant]}), out, 90))
        review_paths[variant] = out.relative_to(output_dir).as_posix()
    size = web_size(image.width, image.height)
    out = asset_dir / "web-original.jpg"
    jobs.append(lambda out=out: save_clean_jpeg(image.resize(size, Image.Resampling.LANCZOS), out, 84))
    review_paths["web_original"] = out.relative_to(output_dir).as_posix()
    out = asset_dir / "web-combined.jpg"
    jobs.append(lambda out=out: save_clean_jpeg(overlay(image, masks).resize(size, Image.Resampling.LANCZOS), out, 84))
    review_paths["web_combined"] = out.relative_to(output_dir).as_posix()
    for disease, mask in masks.items():
        out = asset_dir / f"layer-{slug(disease)}.png"
        jobs.append(lambda mask=mask, disease=disease, out=out: disease_layer(mask, disease).save(out, optimize=True))
        review_paths[f"layer_{disease}"] = out.relative_to(output_dir).as_posix()
    # Pillow and OpenCV release the GIL while encoding, so the derivatives encode side by side.
    with ThreadPoolExecutor(max_workers=4) as pool:
        for future in [pool.submit(job) for job in jobs]:
            future.result()
    return {"source_asset_id": asset_id, "kind": "image", "status": "complete",
            "source_sha256": expected_hash, "width": image.width, "height": image.height,
            "web_width": size[0], "web_height": size[1],
            **metadata, "diseases": diseases, "review_paths": review_paths,
            "measurements": measure(np.asarray(image), masks),
            "ambiguous_overlap_pixels": int((masks["BLB"] & masks["Brown Spot"]).sum()),
            "severity": None}


def run_photos(sources: list[dict], models: dict, output_dir: Path) -> list[dict]:
    if not 1 <= len(sources) <= MAX_PHOTOS or set(models) != set(DISEASES):
        raise ValueError("One to ten photos and both pinned specialists are required")
    if output_dir.exists():
        raise FileExistsError("Private photo results already exist; no output was overwritten")
    output_dir.mkdir(parents=True)
    pending = []
    # The GPU runs the next photo while the previous photo's derivatives are encoded.
    with ThreadPoolExecutor(max_workers=2) as writer:
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
            pending.append(writer.submit(_write_outputs, asset_id, expected_hash, image, metadata, masks, output_dir))
        receipts = [future.result() for future in pending]
    (output_dir / "photo_receipts.json").write_text(json.dumps(receipts, indent=2), encoding="utf-8")
    return receipts
