"""Prepare a private, source-bounded 30 FPS clip for pinned Kaggle inference.

This is input preparation only. It never uploads data, starts a Kaggle kernel,
publishes a bulletin, or claims that inference has completed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

from PIL import Image


FPS = 30
MAX_CLIP_SECONDS = 30
MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def probe(path: Path) -> tuple[int, int, float]:
    completed = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=width,height:format=duration", "-of", "json", str(path),
    ], check=True, capture_output=True, text=True)
    data = json.loads(completed.stdout)
    streams = data.get("streams") or []
    if len(streams) != 1:
        raise ValueError("The source must contain one decodable video stream")
    width, height = int(streams[0]["width"]), int(streams[0]["height"])
    duration = float(data["format"]["duration"])
    if width < 512 or height < 512 or width * height > 60_000_000 or not math.isfinite(duration) or duration <= 0:
        raise ValueError("Unsupported source video dimensions or duration")
    return width, height, duration


def prepare(source: Path, output: Path, start: float, duration: float, linked_photo_asset_id: str) -> dict:
    if not UUID.fullmatch(linked_photo_asset_id):
        raise ValueError("A same-survey photo asset ID is required")
    if not source.is_file() or source.stat().st_size < 12 or source.stat().st_size > MAX_VIDEO_BYTES:
        raise ValueError("Missing or oversized original MP4")
    with source.open("rb") as stream:
        if stream.read(12)[4:8] != b"ftyp":
            raise ValueError("The source is not an MP4 container")
    width, height, source_duration = probe(source)
    if (not math.isfinite(start) or not math.isfinite(duration) or start < 0 or duration <= 0 or
            duration > MAX_CLIP_SECONDS or start + duration > source_duration + 0.01):
        raise ValueError("Select a source-bounded clip of at most 30 seconds")
    expected = duration * FPS
    frame_count = round(expected)
    if frame_count < 1 or frame_count > FPS * MAX_CLIP_SECONDS or abs(expected - frame_count) > 0.01:
        raise ValueError("The selected clip must align to 30 FPS frames")
    if output.exists():
        raise FileExistsError("The output path already exists; existing checkpoints were preserved")

    frames_dir = output / "frames"
    frames_dir.mkdir(parents=True)
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(source),
        "-ss", f"{start:.6f}", "-t", f"{duration:.6f}", "-vf", f"fps={FPS}",
        "-frames:v", str(frame_count), "-q:v", "3", "-map_metadata", "-1", "-an",
        str(frames_dir / "frame_%06d.jpg"),
    ], check=True)
    paths = sorted(frames_dir.glob("frame_*.jpg"))
    if len(paths) != frame_count:
        raise RuntimeError(f"The source yielded {len(paths)} frames, expected {frame_count}")
    receipts = []
    for index, path in enumerate(paths):
        if path.name != f"frame_{index + 1:06d}.jpg":
            raise RuntimeError("Extracted frames are not a contiguous sequence")
        with Image.open(path) as frame:
            if frame.format != "JPEG" or frame.size != (width, height) or frame.getexif():
                raise RuntimeError(f"Frame dimensions or private metadata changed: {path.name}")
        receipts.append({
            "index": index,
            "name": path.name,
            "source_time_seconds": round(start + index / FPS, 6),
            "sha256": digest(path),
        })
    manifest = {
        "schema": "riceguard.website-video-input.v1",
        "source_sha256": digest(source),
        "source_bytes": source.stat().st_size,
        "width": width,
        "height": height,
        "clip_start_seconds": start,
        "clip_duration_seconds": duration,
        "fps": FPS,
        "linked_photo_asset_id": linked_photo_asset_id,
        "frames": receipts,
    }
    temporary = output / "input_manifest.json.tmp"
    temporary.write_text(json.dumps(manifest, sort_keys=True, indent=2), encoding="utf-8")
    temporary.replace(output / "input_manifest.json")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--start", type=float, required=True)
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--linked-photo-asset-id", required=True)
    args = parser.parse_args()
    manifest = prepare(args.source, args.output, args.start, args.duration, args.linked_photo_asset_id)
    print(json.dumps({"status": "prepared_private_input", "frames": len(manifest["frames"]),
                      "fps": manifest["fps"], "dimensions": [manifest["width"], manifest["height"]]}))


if __name__ == "__main__":
    main()

