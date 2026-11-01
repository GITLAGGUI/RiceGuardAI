"""Private 30 FPS video inference with the two pinned lesion specialists.

The input is a verified, sanitized frame set from prepare_clip.py plus the two
private checkpoint files. This module performs no network calls or publication.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
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
from .specialists import PINNED, load_specialists, stitch


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
    return load_specialists(input_dir)


def render(image: Image.Image, masks: dict[str, np.ndarray]) -> np.ndarray:
    return np.asarray(overlay(image, masks))


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


def run(input_dir: Path, output_dir: Path, loaded: tuple | None = None) -> dict:
    started = time.monotonic()
    manifest = validate_input(input_dir)
    if output_dir.exists():
        raise FileExistsError("Private result path already exists; no output was overwritten")
    # Reuse the photo run's verified specialists instead of loading them twice.
    models, environment = loaded or load_models(input_dir)
    masks_dir, frames_dir = output_dir / "masks", output_dir / "review_frames"
    masks_dir.mkdir(parents=True)
    frames_dir.mkdir()
    receipts = []

    def short(disease: str) -> str:
        return "blb" if disease == "BLB" else "brownspot"

    def write_frame(index: int, frame: Image.Image, masks: dict) -> None:
        for disease, mask in masks.items():
            Image.fromarray(mask.astype(np.uint8) * 255).save(masks_dir / f"frame_{index + 1:06d}_{short(disease)}.png")
        if not cv2.imwrite(str(frames_dir / f"frame_{index + 1:06d}.jpg"),
                           cv2.cvtColor(render(frame, masks), cv2.COLOR_RGB2BGR),
                           [cv2.IMWRITE_JPEG_QUALITY, 92]):
            raise RuntimeError("Could not encode review frame")

    pending = []
    # Frame encoding runs beside GPU inference of the following frames.
    with ThreadPoolExecutor(max_workers=3) as writer:
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
            pending.append(writer.submit(write_frame, index, frame, masks))
            if len(pending) > 6:
                pending.pop(0).result()
            receipts.append({"index": index, "source_time_seconds": item["source_time_seconds"],
                             "source_sha256": item["sha256"],
                             "mask_paths": {disease: f"masks/frame_{index + 1:06d}_{short(disease)}.png"
                                            for disease in masks},
                             "predicted_pixels": {disease: int(mask.sum()) for disease, mask in masks.items()},
                             "review_frame_path": f"review_frames/frame_{index + 1:06d}.jpg"})
            if (index + 1) % 30 == 0 or index + 1 == len(manifest["frames"]):
                (output_dir / "progress.json").write_text(json.dumps({"frames_done": index + 1,
                    "frames_total": len(manifest["frames"])}), encoding="utf-8")
        for future in pending:
            future.result()
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

