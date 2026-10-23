"""Private 30 FPS video inference with the two pinned YOLO26m semantic models.

The input is a verified, sanitized frame set from prepare_clip.py plus the two
private checkpoint files. This module performs no network calls or publication.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import time
from zipfile import ZIP_STORED, ZipFile

import cv2
import numpy as np
from PIL import Image

from .prepare_clip import FPS, digest
from workers.aws.inference_core import overlay


TILE = 1024
STRIDE = 768
PINNED = {
    "BLB": ("blb.pt", "aa10d1f6c03baf189c56484db99e96ba55c646be1668d102bdaed78a43315bc6", "Bacterial Leaf Blight"),
    "Brown Spot": ("brownspot.pt", "58a1f4600887577749a22f7a8b43b81174bb082d68afd5f09f1079b79a18bca5", "Brown Spot"),
}


def axis_starts(length: int) -> list[int]:
    if length <= TILE:
        return [0]
    starts = list(range(0, length - TILE + 1, STRIDE))
    if starts[-1] != length - TILE:
        starts.append(length - TILE)
    return starts


def validate_input(input_dir: Path) -> dict:
    path = input_dir / "input_manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    frames = manifest.get("frames")
    width, height = manifest.get("width"), manifest.get("height")
    duration = manifest.get("clip_duration_seconds")
    start = manifest.get("clip_start_seconds")
    if (manifest.get("schema") != "riceguard.website-video-input.v1" or manifest.get("fps") != FPS or
            not isinstance(width, int) or not isinstance(height, int) or width < 512 or height < 512 or
            width * height > 60_000_000 or not isinstance(duration, (int, float)) or
            not isinstance(start, (int, float)) or start < 0 or duration <= 0 or duration > 30 or
            not isinstance(frames, list) or len(frames) != round(duration * FPS) or
            not 1 <= len(frames) <= 900):
        raise ValueError("Invalid source-bounded website video manifest")
    for index, frame in enumerate(frames):
        name = f"frame_{index + 1:06d}.jpg"
        if (frame.get("index") != index or frame.get("name") != name or
                abs(float(frame.get("source_time_seconds", -1)) - (start + index / FPS)) > 0.001 or
                not isinstance(frame.get("sha256"), str) or len(frame["sha256"]) != 64):
            raise ValueError("Invalid source frame sequence")
    return manifest


def load_models(input_dir: Path):
    import torch
    import ultralytics
    from ultralytics import YOLO

    if not torch.cuda.is_available():
        raise RuntimeError("A Kaggle GPU is required; CPU fallback is disabled")
    if ultralytics.__version__ != "8.4.115":
        raise RuntimeError("The verified Ultralytics runtime is required")
    models = {}
    for disease, (filename, expected_hash, class_name) in PINNED.items():
        path = input_dir / filename
        if digest(path) != expected_hash:
            raise ValueError(f"Pinned checkpoint hash mismatch: {disease}")
        model = YOLO(str(path))
        if model.task != "semantic" or model.names.get(1) != class_name:
            raise ValueError(f"Semantic class mapping mismatch: {disease}")
        models[disease] = model
    return models, {"gpu": torch.cuda.get_device_name(0), "torch": torch.__version__,
                    "ultralytics": ultralytics.__version__,
                    "model_hashes": {disease: spec[1] for disease, spec in PINNED.items()}}


def stitch(image: Image.Image, model, device=0) -> np.ndarray:
    width, height = image.size
    tiles = [(x, y, min(x + TILE, width), min(y + TILE, height))
             for y in axis_starts(height) for x in axis_starts(width)]
    votes = np.zeros((height, width), dtype=np.uint8)
    coverage = np.zeros_like(votes)
    for start in range(0, len(tiles), 4):
        chunk = tiles[start:start + 4]
        predictions = model.predict([image.crop(box) for box in chunk], imgsz=TILE, device=device,
                                    half=device != "cpu", batch=len(chunk), verbose=False)
        if len(predictions) != len(chunk):
            raise RuntimeError("A specialist skipped an inference tile")
        for (x1, y1, x2, y2), result in zip(chunk, predictions):
            if result.semantic_mask is None:
                raise RuntimeError("Missing semantic prediction")
            labels = np.asarray(result.semantic_mask.data.detach().cpu().numpy())
            if labels.ndim != 2 or not np.isin(labels, (0, 1)).all():
                raise RuntimeError("Invalid foreground class map")
            if labels.shape != (y2 - y1, x2 - x1):
                labels = cv2.resize(labels.astype(np.uint8), (x2 - x1, y2 - y1),
                                    interpolation=cv2.INTER_NEAREST)
            votes[y1:y2, x1:x2] += (labels == 1).astype(np.uint8)
            coverage[y1:y2, x1:x2] += 1
    if not np.all(coverage):
        raise RuntimeError("Tiled inference left uncovered pixels")
    return votes * 2 >= coverage


def render(image: Image.Image, masks: dict[str, np.ndarray], *, show_boxes=True) -> np.ndarray:
    return np.asarray(overlay(image, masks, show_boxes=show_boxes))


def pack_private_masks(output_dir: Path, receipts: list[dict]) -> tuple[str, str]:
    """Make one immutable archive with independently addressable frame masks."""
    archive = output_dir / "frame_masks.zip"
    if archive.exists():
        raise FileExistsError("Existing private mask archive was preserved")
    members = ["frame_receipts.json"]
    for receipt in receipts:
        members.extend(receipt["mask_paths"][disease] for disease in PINNED)
    if len(members) != len(set(members)):
        raise ValueError("Frame mask paths must be unique")
    with ZipFile(archive, "w", compression=ZIP_STORED, allowZip64=True) as bundle:
        for name in members:
            path = output_dir / name
            if not path.is_file() or not path.resolve().is_relative_to(output_dir.resolve()):
                raise ValueError("Missing or unauthorized private frame mask")
            bundle.write(path, arcname=name)
    with ZipFile(archive) as bundle:
        if bundle.namelist() != members or bundle.testzip() is not None:
            raise RuntimeError("Private mask archive verification failed")
    return archive.name, digest(archive)


def run(input_dir: Path, output_dir: Path) -> dict:
    started = time.monotonic()
    manifest = validate_input(input_dir)
    if output_dir.exists():
        raise FileExistsError("Private result path already exists; no output was overwritten")
    models, environment = load_models(input_dir)
    masks_dir, frames_dir = output_dir / "masks", output_dir / "review_frames"
    masks_dir.mkdir(parents=True)
    frames_dir.mkdir()
    receipts = []
    for item in manifest["frames"]:
        index = item["index"]
        source = input_dir / "frames" / item["name"]
        if digest(source) != item["sha256"]:
            raise ValueError(f"Original extracted frame hash mismatch: {index}")
        with Image.open(source) as opened:
            if opened.format != "JPEG" or opened.size != (manifest["width"], manifest["height"]) or opened.getexif():
                raise ValueError(f"Changed or unsanitized source frame: {index}")
            frame = opened.convert("RGB")
        masks = {disease: stitch(frame, model) for disease, model in models.items()}
        mask_paths = {}
        predicted = {}
        for disease, mask in masks.items():
            short = "blb" if disease == "BLB" else "brownspot"
            path = masks_dir / f"frame_{index + 1:06d}_{short}.png"
            Image.fromarray(mask.astype(np.uint8) * 255).save(path)
            mask_paths[disease] = path.relative_to(output_dir).as_posix()
            predicted[disease] = int(mask.sum())
        preview_path = frames_dir / f"frame_{index + 1:06d}.jpg"
        if not cv2.imwrite(str(preview_path), cv2.cvtColor(render(frame, masks), cv2.COLOR_RGB2BGR),
                           [cv2.IMWRITE_JPEG_QUALITY, 92]):
            raise RuntimeError("Could not encode review frame")
        receipts.append({"index": index, "source_time_seconds": item["source_time_seconds"],
                         "source_sha256": item["sha256"], "mask_paths": mask_paths,
                         "predicted_pixels": predicted,
                         "review_frame_path": preview_path.relative_to(output_dir).as_posix()})
        if (index + 1) % 30 == 0 or index + 1 == len(manifest["frames"]):
            (output_dir / "progress.json").write_text(json.dumps({"frames_done": index + 1,
                "frames_total": len(manifest["frames"])}), encoding="utf-8")
    (output_dir / "frame_receipts.json").write_text(json.dumps(receipts, indent=2), encoding="utf-8")
    archive_name, archive_hash = pack_private_masks(output_dir, receipts)
    video = output_dir / "review.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-framerate", str(FPS),
                    "-i", str(frames_dir / "frame_%06d.jpg"), "-frames:v", str(len(receipts)),
                    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", "-an", str(video)], check=True)
    completed = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                "stream=width,height,nb_frames,duration", "-of", "json", str(video)],
                               check=True, capture_output=True, text=True)
    stream = json.loads(completed.stdout)["streams"][0]
    if ((int(stream["width"]), int(stream["height"]), int(stream["nb_frames"])) !=
            (manifest["width"], manifest["height"], len(receipts)) or
            abs(float(stream["duration"]) - manifest["clip_duration_seconds"]) > 0.01):
        raise RuntimeError("Rendered clip does not match its authorized native source interval")
    publication = output_dir / "publication_candidate.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video),
                    "-map_metadata", "-1", "-c:v", "libx264", "-preset", "medium",
                    "-b:v", "8M", "-maxrate", "8M", "-bufsize", "16M", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", "-an", str(publication)], check=True)
    public_probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                   "stream=width,height,nb_frames,duration", "-of", "json", str(publication)],
                                  check=True, capture_output=True, text=True)
    public_stream = json.loads(public_probe.stdout)["streams"][0]
    if ((int(public_stream["width"]), int(public_stream["height"]), int(public_stream["nb_frames"])) !=
            (manifest["width"], manifest["height"], len(receipts)) or
            abs(float(public_stream["duration"]) - manifest["clip_duration_seconds"]) > 0.01 or
            publication.stat().st_size > 52_428_800):
        raise RuntimeError("Sanitized 4K publication candidate exceeds its verified bounds")
    summary = {"status": "needs_review", "private_review_only": True,
               "source_manifest_sha256": digest(input_dir / "input_manifest.json"),
               "model_hashes": environment["model_hashes"], "environment": environment,
               "linked_photo_asset_id": manifest["linked_photo_asset_id"],
               "clip_start_seconds": manifest["clip_start_seconds"],
               "clip_duration_seconds": manifest["clip_duration_seconds"], "fps": FPS,
               "frames": len(receipts), "dimensions": [manifest["width"], manifest["height"]],
               "video": video.name, "video_sha256": digest(video),
               "publication_candidate": publication.name,
               "publication_candidate_sha256": digest(publication),
               "mask_archive": archive_name, "mask_archive_sha256": archive_hash,
               "severity_status": "not_calibrated",
               "box_meaning": "significant connected mask regions, not leaf instances",
               "runtime_seconds": round(time.monotonic() - started, 2)}
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.input, args.output), sort_keys=True))

