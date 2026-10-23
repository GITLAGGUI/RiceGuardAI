"""Private, idempotent full-resolution photo smoke for user-supplied field media.

This intentionally bypasses the public website and never publishes, notifies, or
edits a CVAT task. It tests the same pinned Batch worker and v2 result adapter.
"""

import argparse
import hashlib
import io
import json
from pathlib import Path
import uuid

import boto3
from botocore.exceptions import ClientError
import numpy as np
from PIL import Image

from deploy_worker import ACCOUNT, BUCKET, NAME, PREFIX, REGION


GROUPS = ((1,), (2, 3, 4), (5, 6, 7, 8), (9, 10))
RUN_BASE = "fieldtest-20260928"
session = boto3.Session(region_name=REGION)
s3 = session.client("s3")
batch = session.client("batch")


def run_id(group):
    return f"{RUN_BASE}-g{group + 1}"


def read_json(key):
    return json.loads(s3.get_object(Bucket=BUCKET, Key=key)["Body"].read())


def receipt_key(group):
    return f"{PREFIX}/jobs/{run_id(group)}/submission.json"


def check_account_and_privacy():
    if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise RuntimeError("Unexpected AWS account")
    block = s3.get_public_access_block(Bucket=BUCKET)["PublicAccessBlockConfiguration"]
    if not all(block.get(name) for name in ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")):
        raise RuntimeError("Private bucket public-access protections are incomplete")


def inactive_queue():
    for state in ("SUBMITTED", "PENDING", "RUNNABLE", "STARTING", "RUNNING"):
        if batch.list_jobs(jobQueue=NAME, jobStatus=state)["jobSummaryList"]:
            raise RuntimeError("Another private inference job is active")


def stage_source(group, number, path):
    if not path.is_file() or path.stat().st_size > 200_000_000:
        raise ValueError(f"Missing or oversized source photo {number}")
    with Image.open(path) as image:
        if image.format not in ("JPEG", "MPO") or image.width * image.height > 60_000_000:
            raise ValueError(f"Photo {number} is not a supported native JPEG")
    with path.open("rb") as source:
        if source.read(3) != b"\xff\xd8\xff":
            raise ValueError(f"Photo {number} lacks a JPEG primary image")
    with path.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    asset_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"riceguard-field-test:{number}:{digest}"))
    key = f"{PREFIX}/jobs/{run_id(group)}/inputs/{asset_id}.jpg"
    try:
        existing = s3.head_object(Bucket=BUCKET, Key=key)
    except ClientError as error:
        if error.response["Error"]["Code"] not in ("404", "NoSuchKey", "NotFound"):
            raise
    else:
        if existing["ContentLength"] != path.stat().st_size or existing.get("Metadata", {}).get("sha256") != digest:
            raise RuntimeError("Private staged source differs; refusing overwrite")
        return {"id": asset_id, "key": key, "sha256": digest}
    s3.upload_file(str(path), BUCKET, key, ExtraArgs={
        "ServerSideEncryption": "AES256", "ContentType": "image/jpeg", "Metadata": {"sha256": digest},
    })
    return {"id": asset_id, "key": key, "sha256": digest}


def submit(group, photos_dir):
    check_account_and_privacy()
    try:
        receipt = read_json(receipt_key(group))
        print(json.dumps({"status": "already_submitted" if receipt.get("job_id") else "submission_uncertain",
                          "group": group + 1, "job_id": receipt.get("job_id")}))
        return
    except ClientError as error:
        if error.response["Error"]["Code"] not in ("NoSuchKey", "404"):
            raise
    if session.client("freetier").get_account_plan_state()["accountPlanRemainingCredits"]["amount"] < 20:
        raise RuntimeError("AWS credit reserve below 20 USD")
    inactive_queue()
    assets = [stage_source(group, number, photos_dir / f"field_photo_{number:02d}.jpg") for number in GROUPS[group]]
    source_hash = hashlib.sha256(json.dumps(assets, sort_keys=True).encode()).hexdigest()
    manifest = {"kind": "photo_batch", "run_id": run_id(group), "source_manifest_hash": source_hash, "assets": assets}
    raw = json.dumps(manifest, sort_keys=True).encode()
    digest = hashlib.sha256(raw).hexdigest()
    key = f"{PREFIX}/jobs/{run_id(group)}/manifest.json"
    s3.put_object(Bucket=BUCKET, Key=key, Body=raw, ContentType="application/json", ServerSideEncryption="AES256")
    # The durable intent precedes Batch submission. An interrupted submit is
    # reconciled manually, never retried blindly into a second chargeable job.
    receipt = {"job_id": None, "manifest_sha256": digest, "source_manifest_hash": source_hash,
               "asset_ids": [a["id"] for a in assets], "photo_numbers": list(GROUPS[group])}
    s3.put_object(Bucket=BUCKET, Key=receipt_key(group), Body=json.dumps(receipt).encode(),
                  ContentType="application/json", ServerSideEncryption="AES256", IfNoneMatch="*")
    job = batch.submit_job(jobName=run_id(group), jobQueue=NAME, jobDefinition=f"{NAME}:4",
        containerOverrides={"environment": [
            {"name": "RICEGUARD_MANIFEST_KEY", "value": key},
            {"name": "RICEGUARD_MANIFEST_SHA256", "value": digest},
        ]}, timeout={"attemptDurationSeconds": 1800}, retryStrategy={"attempts": 1},
        tags={"Project": "RiceGuard", "Purpose": "private-field-photo-validation"})
    receipt["job_id"] = job["jobId"]
    s3.put_object(Bucket=BUCKET, Key=receipt_key(group), Body=json.dumps(receipt).encode(),
                  ContentType="application/json", ServerSideEncryption="AES256")
    print(json.dumps({"status": "submitted", "group": group + 1, "job_id": job["jobId"],
                      "photo_numbers": list(GROUPS[group]), "timeout_seconds": 1800}))


def status(group, verify=False):
    check_account_and_privacy()
    receipt = read_json(receipt_key(group))
    if not receipt.get("job_id"):
        print(json.dumps({"group": group + 1, "status": "submission_uncertain",
                          "manual_reconciliation_required": True}))
        return
    jobs = batch.describe_jobs(jobs=[receipt["job_id"]])["jobs"]
    if len(jobs) != 1:
        raise RuntimeError("Batch receipt no longer resolves to one job")
    job = jobs[0]
    summary = {"group": group + 1, "job_id": job["jobId"], "status": job["status"],
               "reason": job.get("statusReason"), "photo_numbers": receipt["photo_numbers"]}
    progress_key = f"{PREFIX}/jobs/{run_id(group)}/outputs/{receipt['manifest_sha256']}/progress.json"
    try:
        summary["progress"] = read_json(progress_key)
    except ClientError as error:
        if error.response["Error"]["Code"] not in ("NoSuchKey", "404"):
            raise
    if not verify or job["status"] != "SUCCEEDED":
        print(json.dumps(summary))
        return
    prefix = f"{PREFIX}/jobs/{run_id(group)}/outputs/{receipt['manifest_sha256']}"
    raw = read_json(f"{prefix}/result.json")
    v2 = read_json(f"{prefix}/website-result.json")
    if raw["status"] != "needs_review" or v2["schema_version"] != "riceguard.result.v2":
        raise RuntimeError("Private worker or website contract is incomplete")
    if v2["source_manifest_hash"] != receipt["source_manifest_hash"] or len(v2["assets"]) != len(GROUPS[group]):
        raise RuntimeError("Website contract does not match staged originals")
    evidence = []
    for asset in raw["assets"]:
        if (asset["width"], asset["height"]) != (8064, 4536) or asset["location"]["source"] != "dji_xmp":
            raise RuntimeError("Native dimensions or DJI XMP location provenance were not preserved privately")
        if {finding["disease"] for finding in asset["diseases"]} != {"BLB", "Brown Spot"}:
            raise RuntimeError("A specialist result is missing")
        for finding in asset["diseases"]:
            data = s3.get_object(Bucket=BUCKET, Key=finding["mask_path"])["Body"].read()
            with Image.open(io.BytesIO(data)) as image:
                if image.size != (8064, 4536) or int((np.asarray(image) == 255).sum()) != finding["predicted_pixels"]:
                    raise RuntimeError("Full-resolution mask does not match the result")
        for media in asset["media"]:
            data = s3.get_object(Bucket=BUCKET, Key=media["key"])["Body"].read()
            with Image.open(io.BytesIO(data)) as image:
                if image.size != (8064, 4536) or image.getexif():
                    raise RuntimeError("Review image is resized or exposes EXIF")
        evidence.append({"photo_id": asset["asset_id"], "location_source": "dji_xmp",
                         "predicted_pixels": {f["disease"]: f["predicted_pixels"] for f in asset["diseases"]}})
    summary.update({"verified": True, "runtime_seconds": raw["seconds"], "private_photos": evidence,
                    "website_activated": False, "staff_review_required": True})
    print(json.dumps(summary))


def save_review_preview(group, output_dir):
    """Save only a verified, sanitized review derivative for local visual QA."""
    receipt = read_json(receipt_key(group))
    jobs = batch.describe_jobs(jobs=[receipt["job_id"]])["jobs"]
    if len(jobs) != 1 or jobs[0]["status"] != "SUCCEEDED":
        raise RuntimeError("Review preview is not ready")
    prefix = f"{PREFIX}/jobs/{run_id(group)}/outputs/{receipt['manifest_sha256']}"
    result = read_json(f"{prefix}/result.json")
    output_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for index, (number, asset) in enumerate(zip(GROUPS[group], result["assets"])):
        if asset["asset_id"] != receipt["asset_ids"][index]:
            raise RuntimeError("Review preview does not match the staged source order")
        previews = [m for m in asset["media"] if m["variant"] == "combined"]
        if len(previews) != 1 or not previews[0].get("private") or not previews[0].get("sanitized"):
            raise RuntimeError("Combined preview is not a private sanitized derivative")
        data = s3.get_object(Bucket=BUCKET, Key=previews[0]["key"])["Body"].read()
        with Image.open(io.BytesIO(data)) as image:
            if image.size != (8064, 4536) or image.getexif():
                raise RuntimeError("Review preview is resized or retains EXIF")
        path = output_dir / f"field_photo_{number:02d}_combined.jpg"
        if path.exists() and hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(data).digest():
            raise RuntimeError("Existing local review preview differs")
        path.write_bytes(data)
        saved.append(str(path))
    print(json.dumps({"status": "saved_private_qa_derivatives", "files": saved}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("submit", "status", "verify", "preview"))
    parser.add_argument("--group", type=int, required=True, choices=(1, 2, 3, 4))
    parser.add_argument("--photos-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    if args.action == "submit":
        if not args.photos_dir:
            parser.error("--photos-dir is required for submission")
        submit(args.group - 1, args.photos_dir)
    elif args.action == "preview":
        if not args.output_dir:
            parser.error("--output-dir is required for preview")
        save_review_preview(args.group - 1, args.output_dir)
    else:
        status(args.group - 1, args.action == "verify")
