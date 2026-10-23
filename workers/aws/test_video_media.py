"""Private, resumable 5 fps test of only the user-selected 104-135 s video interval.

Each video frame is processed by the same two pinned semantic specialists as a
photo, never by copying masks between frames. This is an isolated test; it does
not activate website video upload or publish a bulletin.
"""

import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import time
import uuid

from botocore.exceptions import ClientError
import numpy as np
from PIL import Image

from deploy_worker import BUCKET, NAME, PREFIX
from test_field_media import batch, check_account_and_privacy, inactive_queue, read_json, s3, session


FRAME_COUNT = 155
FRAMES_PER_JOB = 4
GROUP_COUNT = (FRAME_COUNT + FRAMES_PER_JOB - 1) // FRAMES_PER_JOB
RUN_BASE = "fieldvideo-20260928"
JOB_DEFINITION = f"{NAME}:4"
MIN_REMAINING_CREDITS_USD = 100


def frame_numbers(group):
    first = group * FRAMES_PER_JOB + 1
    return tuple(range(first, min(first + FRAMES_PER_JOB, FRAME_COUNT + 1)))


def run_id(group):
    return f"{RUN_BASE}-c{group + 1:02d}"


def receipt_key(group):
    return f"{PREFIX}/jobs/{run_id(group)}/submission.json"


def stage_frame(group, number, path):
    if not path.is_file() or path.stat().st_size > 200_000_000:
        raise ValueError(f"Missing or oversized video frame {number}")
    with Image.open(path) as image:
        if image.format != "JPEG" or image.size != (3840, 2160):
            raise ValueError(f"Frame {number} is not a native 4K JPEG")
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    asset_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"riceguard-video-104-135:{number}:{digest}"))
    key = f"{PREFIX}/jobs/{run_id(group)}/inputs/{asset_id}.jpg"
    try:
        existing = s3.head_object(Bucket=BUCKET, Key=key)
    except ClientError as error:
        if error.response["Error"]["Code"] not in ("404", "NoSuchKey", "NotFound"):
            raise
    else:
        if existing["ContentLength"] != path.stat().st_size or existing.get("Metadata", {}).get("sha256") != digest:
            raise RuntimeError("Staged frame differs; refusing overwrite")
        return {"id": asset_id, "key": key, "sha256": digest}
    s3.upload_file(str(path), BUCKET, key, ExtraArgs={"ServerSideEncryption": "AES256",
        "ContentType": "image/jpeg", "Metadata": {"sha256": digest}})
    return {"id": asset_id, "key": key, "sha256": digest}


def existing_receipt(group):
    try:
        return read_json(receipt_key(group))
    except ClientError as error:
        if error.response["Error"]["Code"] not in ("NoSuchKey", "404"):
            raise
        return None


def submit(group, frames_dir):
    check_account_and_privacy()
    receipt = existing_receipt(group)
    if receipt:
        if not receipt.get("job_id"):
            raise RuntimeError("Interrupted submission requires manual reconciliation")
        return receipt
    remaining = session.client("freetier").get_account_plan_state()["accountPlanRemainingCredits"]["amount"]
    if remaining < MIN_REMAINING_CREDITS_USD:
        raise RuntimeError("Credit reserve reached; stopping before another job")
    inactive_queue()
    assets = [stage_frame(group, number, frames_dir / f"frame_{number:04d}.jpg")
              for number in frame_numbers(group)]
    source_hash = hashlib.sha256(json.dumps(assets, sort_keys=True).encode()).hexdigest()
    manifest = {"kind": "photo_batch", "run_id": run_id(group), "source_manifest_hash": source_hash,
                "video_interval_seconds": [104, 135], "sampling_fps": 5,
                "frame_numbers": list(frame_numbers(group)), "assets": assets}
    raw = json.dumps(manifest, sort_keys=True).encode()
    digest = hashlib.sha256(raw).hexdigest()
    key = f"{PREFIX}/jobs/{run_id(group)}/manifest.json"
    s3.put_object(Bucket=BUCKET, Key=key, Body=raw, ContentType="application/json",
                  ServerSideEncryption="AES256", IfNoneMatch="*")
    receipt = {"job_id": None, "manifest_sha256": digest, "source_manifest_hash": source_hash,
               "asset_ids": [a["id"] for a in assets], "frame_numbers": list(frame_numbers(group))}
    s3.put_object(Bucket=BUCKET, Key=receipt_key(group), Body=json.dumps(receipt).encode(),
                  ContentType="application/json", ServerSideEncryption="AES256", IfNoneMatch="*")
    job = batch.submit_job(jobName=run_id(group), jobQueue=NAME, jobDefinition=JOB_DEFINITION,
        containerOverrides={"environment": [
            {"name": "RICEGUARD_MANIFEST_KEY", "value": key},
            {"name": "RICEGUARD_MANIFEST_SHA256", "value": digest},
        ]}, timeout={"attemptDurationSeconds": 1800}, retryStrategy={"attempts": 1},
        tags={"Project": "RiceGuard", "Purpose": "private-31-second-video-validation"})
    receipt["job_id"] = job["jobId"]
    s3.put_object(Bucket=BUCKET, Key=receipt_key(group), Body=json.dumps(receipt).encode(),
                  ContentType="application/json", ServerSideEncryption="AES256")
    print(json.dumps({"group": group + 1, "status": "submitted", "job_id": job["jobId"],
                      "frames": receipt["frame_numbers"]}), flush=True)
    return receipt


def job_status(group):
    receipt = existing_receipt(group)
    if not receipt:
        return {"group": group + 1, "status": "not_submitted"}
    if not receipt.get("job_id"):
        return {"group": group + 1, "status": "submission_uncertain"}
    jobs = batch.describe_jobs(jobs=[receipt["job_id"]])["jobs"]
    if len(jobs) != 1:
        raise RuntimeError("Receipt does not resolve to exactly one Batch job")
    job = jobs[0]
    status = {"group": group + 1, "status": job["status"], "job_id": job["jobId"],
              "frames": receipt["frame_numbers"], "reason": job.get("statusReason")}
    progress_key = f"{PREFIX}/jobs/{run_id(group)}/outputs/{receipt['manifest_sha256']}/progress.json"
    try:
        status["progress"] = read_json(progress_key)
    except ClientError as error:
        if error.response["Error"]["Code"] not in ("NoSuchKey", "404"):
            raise
    return status


def verify_and_download(group, output_dir):
    receipt = existing_receipt(group)
    if not receipt or job_status(group)["status"] != "SUCCEEDED":
        raise RuntimeError("Video frame group has not succeeded")
    prefix = f"{PREFIX}/jobs/{run_id(group)}/outputs/{receipt['manifest_sha256']}"
    raw = read_json(f"{prefix}/result.json")
    v2 = read_json(f"{prefix}/website-result.json")
    if raw["status"] != "needs_review" or v2["schema_version"] != "riceguard.result.v2":
        raise RuntimeError("Incomplete private model result")
    if v2["source_manifest_hash"] != receipt["source_manifest_hash"] or len(raw["assets"]) != len(frame_numbers(group)):
        raise RuntimeError("Video frame result does not match manifest")
    output_dir.mkdir(parents=True, exist_ok=True)
    counts = []
    for number, asset in zip(frame_numbers(group), raw["assets"]):
        if asset["asset_id"] != receipt["asset_ids"][number - frame_numbers(group)[0]]:
            raise RuntimeError("Frame order or source ID changed")
        if (asset["width"], asset["height"]) != (3840, 2160) or asset["location"]["source"] != "missing":
            raise RuntimeError("Frame dimensions or GPS provenance are invalid")
        if {finding["disease"] for finding in asset["diseases"]} != {"BLB", "Brown Spot"}:
            raise RuntimeError("One disease model was skipped")
        disease_counts = {}
        for finding in asset["diseases"]:
            data = s3.get_object(Bucket=BUCKET, Key=finding["mask_path"])["Body"].read()
            with Image.open(io.BytesIO(data)) as image:
                if image.size != (3840, 2160) or int((np.asarray(image) == 255).sum()) != finding["predicted_pixels"]:
                    raise RuntimeError("Full-resolution frame mask does not match prediction")
            disease_counts[finding["disease"]] = finding["predicted_pixels"]
        previews = [m for m in asset["media"] if m["variant"] == "combined"]
        if len(previews) != 1 or not previews[0].get("private") or not previews[0].get("sanitized"):
            raise RuntimeError("Combined frame preview is not private and sanitized")
        data = s3.get_object(Bucket=BUCKET, Key=previews[0]["key"])["Body"].read()
        with Image.open(io.BytesIO(data)) as image:
            if image.size != (3840, 2160) or image.getexif():
                raise RuntimeError("Review frame changed dimensions or retained EXIF")
        path = output_dir / f"frame_{number:04d}.jpg"
        if path.exists() and hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(data).digest():
            raise RuntimeError("Downloaded frame differs from verified private output")
        path.write_bytes(data)
        counts.append({"frame": number, "time_seconds": round(104 + (number - 1) / 5, 3),
                       "predicted_pixels": disease_counts})
    print(json.dumps({"group": group + 1, "status": "verified", "runtime_seconds": raw["seconds"],
                      "frames": counts}), flush=True)


def run_all(frames_dir, output_dir):
    for group in range(GROUP_COUNT):
        status = job_status(group)
        if status["status"] == "not_submitted":
            submit(group, frames_dir)
        elif status["status"] == "submission_uncertain":
            raise RuntimeError("Submission needs manual reconciliation; no duplicate job launched")
        while True:
            status = job_status(group)
            if status["status"] == "SUCCEEDED":
                verify_and_download(group, output_dir)
                break
            if status["status"] == "FAILED":
                raise RuntimeError(f"Frame group {group + 1} failed: {status['reason']}")
            time.sleep(30)
    print(json.dumps({"status": "all_frames_verified", "frames": FRAME_COUNT}), flush=True)


def assemble(output_dir, video_path):
    missing = [n for n in range(1, FRAME_COUNT + 1) if not (output_dir / f"frame_{n:04d}.jpg").is_file()]
    if missing:
        raise RuntimeError(f"Cannot assemble missing frames: {missing[:10]}")
    if video_path.exists():
        raise RuntimeError("Output video already exists; refusing overwrite")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-framerate", "5",
        "-i", str(output_dir / "frame_%04d.jpg"), "-frames:v", str(FRAME_COUNT),
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-an", str(video_path)], check=True)
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,nb_frames,duration", "-of", "json", str(video_path)],
        capture_output=True, text=True, check=True)
    stream = json.loads(probe.stdout)["streams"][0]
    if (stream["width"], stream["height"], int(stream["nb_frames"])) != (3840, 2160, FRAME_COUNT) or abs(float(stream["duration"]) - 31) > 0.01:
        raise RuntimeError("Annotated video is not the selected native 31-second interval")
    print(json.dumps({"status": "private_review_video_ready", "file": str(video_path),
                      "duration_seconds": 31, "frames": FRAME_COUNT, "fps": 5}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("status", "submit", "verify", "run-all", "assemble"))
    parser.add_argument("--group", type=int, choices=range(1, GROUP_COUNT + 1))
    parser.add_argument("--frames-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--video-path", type=Path)
    args = parser.parse_args()
    if args.action in ("status", "submit", "verify") and not args.group:
        parser.error("--group is required")
    if args.action in ("submit", "run-all") and not args.frames_dir:
        parser.error("--frames-dir is required")
    if args.action in ("verify", "run-all", "assemble") and not args.output_dir:
        parser.error("--output-dir is required")
    if args.action == "assemble" and not args.video_path:
        parser.error("--video-path is required")
    if args.action == "status":
        print(json.dumps(job_status(args.group - 1)))
    elif args.action == "submit":
        submit(args.group - 1, args.frames_dir)
    elif args.action == "verify":
        verify_and_download(args.group - 1, args.output_dir)
    elif args.action == "run-all":
        run_all(args.frames_dir, args.output_dir)
    else:
        assemble(args.output_dir, args.video_path)
