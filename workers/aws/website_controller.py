"""HMAC-gated AWS Lambda control plane for private website photo jobs.

No model weights or images are public. This controller stages verified Google
Drive originals, submits at most one bounded Batch job, and reports private
review assets only to authenticated Supabase Edge Functions.
"""

import hashlib
import hmac
import json
import os
import base64
from pathlib import Path
import re
import tempfile
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


BUCKET = "riceguard-l40s-78407276-20260824"
PREFIX = "website-inference/v2"
DISPATCH_LOCK = f"{PREFIX}/control/dispatch.lock"
QUEUE = "riceguard-private-inference"
JOB_DEFINITION = "riceguard-private-inference:4"
ACCOUNT = "342278407276"
BUNDLE_SHA256 = "98faa7b8541366bfd5751036f8111930fa3bb8cb2f0233d90c6c3d82e683a0da"
# Kaggle website workflow: b10 UNet ConvNeXt-B (BLB) + YOLO26l semantic (Brown Spot).
PINNED_BUNDLE_SHA256 = "0cdd9ec7c4846f5bf8c15449081bef38be1379da715f04240aab68161add86fd"
PINNED_BUNDLE_ID = "riceguard-b10unet-yolo26l-20261023"
PINNED_MODELS = {
    "BLB": ("7006f33bf08cdfe291a2e3907b28e9e71107289ad6ea81299c9c9b17e98bdf17", "unet-convnext-b-dinov3"),
    "Brown Spot": ("b311478a6c47e353c353b9ec060a3e885ad431394d7dade04b6972fd59060b33", "yolo26l-semantic"),
}
# Photo classifier (ConvNeXt-Small, fp32 ONNX) for the informative per-photo percentages.
CLASSIFIER_SHA256 = "aa85bf51dcc656347c21d01048b85314a9ea2e0fd02ad10228efb328a9c44c77"
MAX_SOURCE = 200_000_000
s3 = boto3.client("s3")
presign_s3 = boto3.client("s3", config=Config(signature_version="s3v4"))
batch = boto3.client("batch")


def reply(status, body):
    return {"statusCode": status, "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
            "body": json.dumps(body)}


def private_key(run_id, suffix):
    if not isinstance(run_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", run_id):
        raise ValueError("Invalid run identifier")
    return f"{PREFIX}/jobs/{run_id}/{suffix}"


def read_json(key):
    return json.loads(s3.get_object(Bucket=BUCKET, Key=key)["Body"].read())


def put_json(key, value):
    s3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps(value, sort_keys=True).encode(),
                  ContentType="application/json", ServerSideEncryption="AES256")


def claim_global_job_lock(job_id, run_id):
    # S3 conditional PUT is atomic. With this account's low Lambda concurrency
    # limit, reserved concurrency cannot be set to one; the durable lock keeps
    # a second invocation from submitting another chargeable Batch job.
    try:
        s3.put_object(Bucket=BUCKET, Key=DISPATCH_LOCK,
            Body=json.dumps({"job_id": job_id, "run_id": run_id}).encode(),
            ContentType="application/json", ServerSideEncryption="AES256", IfNoneMatch="*")
        return True
    except ClientError as error:
        if error.response["Error"]["Code"] in ("PreconditionFailed", "ConditionalRequestConflict"):
            return False
        raise


def release_global_job_lock(job_id, run_id):
    try:
        lock = read_json(DISPATCH_LOCK)
    except ClientError as error:
        if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return
        raise
    if lock != {"job_id": job_id, "run_id": run_id}:
        raise RuntimeError("Global dispatch lock belongs to another job")
    s3.delete_object(Bucket=BUCKET, Key=DISPATCH_LOCK)


def callback(token, payload):
    url = os.environ["RICEGUARD_CALLBACK_URL"]
    if not re.fullmatch(r"https://[a-z0-9]+\.supabase\.co/functions/v1/worker-callback", url):
        raise RuntimeError("Untrusted callback destination")
    body = json.dumps(payload).encode()
    request = Request(url, data=body, headers={"Authorization": f"Bearer {token}",
                      "Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        raise RuntimeError(f"Worker callback returned HTTP {error.code}") from error


def verify_meta(meta, body):
    if meta.get("job_id") != body["job_id"] or meta.get("run_id") != body["run_id"]:
        raise ValueError("Callback manifest does not match dispatch")
    if meta.get("pinned_bundle_sha256") != BUNDLE_SHA256:
        raise ValueError("Unpinned model bundle")
    source = meta.get("source_manifest") or {}
    assets = source.get("assets")
    if source.get("execution_provider") != "aws" or not isinstance(assets, list) or not 1 <= len(assets) <= 4:
        raise ValueError("Unsupported source manifest")
    if not re.fullmatch(r"[0-9a-f]{64}", meta.get("source_manifest_hash", "")):
        raise ValueError("Invalid source manifest hash")
    for asset in assets:
        if not re.fullmatch(r"[0-9a-f-]{36}", asset.get("id", ""), re.IGNORECASE) or asset.get("state") != "Verified":
            raise ValueError("Unverified source asset")
        if asset.get("mime") not in ("image/jpeg", "image/png") or not 1 <= int(asset.get("bytes", 0)) <= MAX_SOURCE:
            raise ValueError("Unsupported source media")
        if not re.fullmatch(r"[0-9a-f]{64}", asset.get("checksum", "")) or not asset.get("drive_file_id"):
            raise ValueError("Missing source checksum or Drive identifier")
    return assets


def stage_photo(run_id, asset, drive_token):
    file_id = asset["drive_file_id"]
    if not re.fullmatch(r"[a-zA-Z0-9_-]{8,200}", file_id):
        raise ValueError("Invalid Google Drive file identifier")
    request = Request(f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media",
                      headers={"Authorization": f"Bearer {drive_token}"})
    digest = hashlib.sha256()
    with urlopen(request, timeout=90) as response, tempfile.NamedTemporaryFile() as tmp:
        total = 0
        first = b""
        while True:
            part = response.read(1024 * 1024)
            if not part:
                break
            if total == 0:
                first = part[:16]
            total += len(part)
            if total > MAX_SOURCE:
                raise ValueError("Source exceeds the private worker limit")
            digest.update(part)
            tmp.write(part)
        if total != int(asset["bytes"]) or digest.hexdigest() != asset["checksum"]:
            raise ValueError("Source checksum or byte length mismatch")
        if asset["mime"] == "image/jpeg" and not first.startswith(b"\xff\xd8\xff"):
            raise ValueError("JPEG signature mismatch")
        if asset["mime"] == "image/png" and not first.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("PNG signature mismatch")
        tmp.flush()
        key = private_key(run_id, f"inputs/{asset['id']}")
        s3.upload_file(tmp.name, BUCKET, key, ExtraArgs={"ServerSideEncryption": "AES256",
            "ContentType": asset["mime"], "Metadata": {"sha256": digest.hexdigest()}})
    return {"id": asset["id"], "key": key, "sha256": digest.hexdigest()}


def submit(body):
    run_id = body["run_id"]
    receipt_key = private_key(run_id, "submission.json")
    try:
        receipt = read_json(receipt_key)
        if receipt["job_id"] != body["job_id"]:
            raise ValueError("Run already belongs to another job")
        if not receipt.get("aws_job_ref"):
            return {"status": "submission_uncertain", "code": "MANUAL_RECONCILIATION"}
        return {"job_ref": receipt["aws_job_ref"], "status": "already_submitted"}
    except ClientError as error:
        if error.response["Error"]["Code"] not in ("NoSuchKey", "404"):
            raise
    if boto3.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise RuntimeError("Unexpected AWS account")
    if boto3.client("freetier").get_account_plan_state()["accountPlanRemainingCredits"]["amount"] < 20:
        return {"status": "waiting_for_allowance", "code": "CREDIT_RESERVE"}
    for state in ("SUBMITTED", "PENDING", "RUNNABLE", "STARTING", "RUNNING"):
        if batch.list_jobs(jobQueue=QUEUE, jobStatus=state)["jobSummaryList"]:
            return {"status": "waiting_for_capacity", "code": "CAPACITY_LIMIT"}
    meta = callback(body["worker_token"], {"action": "manifest-aws", "job_id": body["job_id"]})
    assets = verify_meta(meta, body)
    staged = [stage_photo(run_id, asset, meta["drive_access_token"]) for asset in assets]
    manifest = {"kind": "photo_batch", "run_id": run_id,
        "source_manifest_hash": meta["source_manifest_hash"], "assets": staged}
    raw = json.dumps(manifest, sort_keys=True).encode()
    manifest_sha = hashlib.sha256(raw).hexdigest()
    manifest_key = private_key(run_id, "manifest.json")
    s3.put_object(Bucket=BUCKET, Key=manifest_key, Body=raw, ContentType="application/json",
                  ServerSideEncryption="AES256")
    if not claim_global_job_lock(body["job_id"], run_id):
        return {"status": "waiting_for_capacity", "code": "CAPACITY_LIMIT"}
    # Persist an intent *before* the external submit. If Lambda stops after
    # Batch accepts the job but before the receipt update, a retry must not
    # spend credits on a duplicate run; an operator can reconcile by job name.
    receipt = {"job_id": body["job_id"], "run_id": run_id, "aws_job_ref": None,
        "manifest_sha256": manifest_sha, "worker_token": body["worker_token"], "callback_delivered": False}
    put_json(receipt_key, receipt)
    job = batch.submit_job(jobName=run_id, jobQueue=QUEUE, jobDefinition=JOB_DEFINITION,
        containerOverrides={"environment": [{"name": "RICEGUARD_MANIFEST_KEY", "value": manifest_key},
            {"name": "RICEGUARD_MANIFEST_SHA256", "value": manifest_sha}]},
        timeout={"attemptDurationSeconds": 1800}, retryStrategy={"attempts": 1},
        tags={"Project": "RiceGuard", "Purpose": "private-website-inference"})
    receipt["aws_job_ref"] = job["jobId"]
    put_json(receipt_key, receipt)
    return {"job_ref": job["jobId"], "status": "submitted"}


def status(body):
    receipt_key = private_key(body["run_id"], "submission.json")
    receipt = read_json(receipt_key)
    if receipt["job_id"] != body["job_id"]:
        raise ValueError("Job/run mismatch")
    job = batch.describe_jobs(jobs=[receipt["aws_job_ref"]])["jobs"][0]
    state = job["status"]
    if state == "SUCCEEDED" and not receipt["callback_delivered"]:
        key = private_key(body["run_id"], f"outputs/{receipt['manifest_sha256']}/website-result.json")
        result = read_json(key)
        if result.get("run_id") != body["run_id"]:
            raise ValueError("Worker result/run mismatch")
        prefix = private_key(body["run_id"], f"outputs/{receipt['manifest_sha256']}/")
        for asset in result.get("assets", []):
            for path in list(asset.get("review_paths", {}).values()) + [d.get("mask_path") for d in asset.get("diseases", [])]:
                if not isinstance(path, str) or not path.startswith(prefix) or ".." in path:
                    raise ValueError("Worker result contains an unauthorized object key")
                s3.head_object(Bucket=BUCKET, Key=path)
        delivered = callback(receipt["worker_token"], {"action": "complete-v2", "job_id": body["job_id"],
            "sequence": 1, "payload": {"result_manifest": result}})
        if not delivered.get("accepted"):
            raise RuntimeError("Website did not accept the private result")
        receipt["callback_delivered"] = True
        put_json(receipt_key, receipt)
    elif state == "FAILED" and not receipt["callback_delivered"]:
        delivered = callback(receipt["worker_token"], {"action": "failed", "job_id": body["job_id"],
            "sequence": 1, "payload": {"error": "Private inference worker failed; inspect the authorized AWS job logs."}})
        if delivered.get("accepted"):
            receipt["callback_delivered"] = True
            put_json(receipt_key, receipt)
    if state in ("SUCCEEDED", "FAILED") and receipt["callback_delivered"]:
        release_global_job_lock(body["job_id"], body["run_id"])
    return {"status": state.lower(), "job_ref": receipt["aws_job_ref"],
            "callback_delivered": receipt["callback_delivered"]}


def signed_review(body):
    receipt = read_json(private_key(body["run_id"], "submission.json"))
    if receipt["job_id"] != body["job_id"] or not receipt["callback_delivered"]:
        raise ValueError("Review result is not ready")
    result = read_json(private_key(body["run_id"], f"outputs/{receipt['manifest_sha256']}/website-result.json"))
    allowed = {m["path"] for m in result["media"] if m.get("sanitized") is True}
    keys = body.get("paths")
    if not isinstance(keys, list) or len(keys) > 16 or any(key not in allowed for key in keys):
        raise ValueError("Unauthorized review media path")
    return {key: s3.generate_presigned_url("get_object", Params={"Bucket": BUCKET, "Key": key}, ExpiresIn=900)
            for key in keys}


def signed_pinned_review(body):
    """Private staff-review URLs only; the Edge caller owns result membership."""
    run_id = body.get("run_id", "")
    paths = body.get("paths")
    if (not isinstance(run_id, str) or not re.fullmatch(r"rg-[a-z0-9-]{8,80}", run_id) or
            not isinstance(paths, list) or not 1 <= len(paths) <= 44 or
            any(not isinstance(key, str) for key in paths) or len(paths) != len(set(paths))):
        raise ValueError("Invalid pinned review request")
    prefix = f"{PREFIX}/jobs/{run_id}/outputs/"
    if any(not isinstance(key, str) or not key.startswith(prefix) or ".." in key or
           "?" in key or ":" in key or "\\" in key or
           not key.endswith((".jpg", ".png", ".mp4")) for key in paths):
        raise ValueError("Unauthorized private review key")
    return {key: s3.generate_presigned_url("get_object", Params={"Bucket": BUCKET, "Key": key}, ExpiresIn=900)
            for key in paths}


def signed_pinned_models(body):
    """Return short-lived GET URLs only for the immutable private model bundle."""
    run_id = body.get("run_id", "")
    if not isinstance(run_id, str) or not re.fullmatch(r"rg-[a-z0-9-]{8,80}", run_id):
        raise ValueError("Invalid pinned run identifier")
    bundle_key = f"{PREFIX}/bundles/{PINNED_BUNDLE_SHA256}.json"
    raw = s3.get_object(Bucket=BUCKET, Key=bundle_key)["Body"].read()
    if hashlib.sha256(raw).hexdigest() != PINNED_BUNDLE_SHA256:
        raise ValueError("Private model bundle checksum differs")
    bundle = json.loads(raw)
    if bundle.get("id") != PINNED_BUNDLE_ID or set(bundle.get("models", {})) != set(PINNED_MODELS):
        raise ValueError("Unexpected private model bundle")
    downloads = {}
    for disease, (expected_hash, architecture) in PINNED_MODELS.items():
        model = bundle["models"][disease]
        key = model.get("key")
        if (model.get("sha256") != expected_hash or key != f"{PREFIX}/models/{expected_hash}.pt" or
                model.get("architecture") != architecture):
            raise ValueError("Unpinned private model artifact")
        head = s3.head_object(Bucket=BUCKET, Key=key)
        if (head.get("ContentLength") != model.get("bytes") or
                head.get("Metadata", {}).get("sha256") != expected_hash):
            raise ValueError("Private model object verification failed")
        downloads[disease] = presign_s3.generate_presigned_url(
            "get_object", Params={"Bucket": BUCKET, "Key": key}, ExpiresIn=900)
    return {"bundle": bundle, "model_downloads": downloads, "classifier": signed_classifier(),
            "expires_in_seconds": 900}


def signed_classifier():
    """The informative photo classifier: optional, so a missing object never blocks the specialists."""
    key = f"{PREFIX}/models/{CLASSIFIER_SHA256}.onnx"
    try:
        manifest = json.loads(s3.get_object(Bucket=BUCKET, Key=f"{PREFIX}/models/{CLASSIFIER_SHA256}.json")["Body"].read())
        head = s3.head_object(Bucket=BUCKET, Key=key)
        if (manifest.get("sha256") != CLASSIFIER_SHA256 or manifest.get("key") != key or
                head.get("ContentLength") != manifest.get("bytes") or
                head.get("Metadata", {}).get("sha256") != CLASSIFIER_SHA256):
            raise ValueError("Unpinned classifier object")
    except Exception:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        return None
    return {"manifest": manifest, "download": presign_s3.generate_presigned_url(
        "get_object", Params={"Bucket": BUCKET, "Key": key}, ExpiresIn=900)}


def pinned_artifact_receipts(body):
    run_id = body.get("run_id", "")
    artifacts = body.get("artifacts")
    if not isinstance(run_id, str) or not re.fullmatch(r"rg-[a-z0-9-]{8,80}", run_id):
        raise ValueError("Invalid pinned run identifier")
    # The Edge caller partitions a full ten-photo-plus-video manifest into
    # bounded requests. A final partition can legitimately contain one item.
    if not isinstance(artifacts, dict) or not 1 <= len(artifacts) <= 26:
        raise ValueError("Expected private mask and review artifact set is missing")
    prefix = f"{PREFIX}/jobs/{run_id}/outputs/"
    total_bytes = 0
    for key, expected in artifacts.items():
        if (not isinstance(key, str) or not key.startswith(prefix) or
                ".." in key or "?" in key or ":" in key or "\\" in key or
                not isinstance(expected, dict) or
                not re.fullmatch(r"[a-f0-9]{64}", expected.get("sha256", "")) or
                type(expected.get("bytes")) is not int or
                not 1 <= expected["bytes"] <= 4_000_000_000):
            raise ValueError("Invalid private artifact receipt")
        total_bytes += expected["bytes"]
    if total_bytes > 4_500_000_000:
        raise ValueError("Private artifact batch exceeds the bounded upload size")
    return artifacts


def signed_pinned_uploads(body):
    """Short-lived private single-part PUT URLs bound to S3-checked SHA-256."""
    artifacts = pinned_artifact_receipts(body)
    urls = {}
    for key, expected in artifacts.items():
        checksum = base64.b64encode(bytes.fromhex(expected["sha256"])).decode("ascii")
        urls[key] = presign_s3.generate_presigned_url("put_object", Params={
            "Bucket": BUCKET, "Key": key, "ChecksumSHA256": checksum,
            "ContentLength": expected["bytes"], "ServerSideEncryption": "AES256",
        }, ExpiresIn=900, HttpMethod="PUT")
    return {"private_uploads": urls, "expires_in_seconds": 900}


def verify_pinned_artifacts(body):
    """Independently check S3-validated checksums before finalization."""
    artifacts = pinned_artifact_receipts(body)
    for key, expected in artifacts.items():
        head = s3.head_object(Bucket=BUCKET, Key=key, ChecksumMode="ENABLED")
        expected_s3_checksum = base64.b64encode(bytes.fromhex(expected["sha256"])).decode("ascii")
        if (head.get("ContentLength") != expected["bytes"] or
                head.get("ChecksumSHA256") != expected_s3_checksum):
            raise ValueError("Private artifact size or S3-validated checksum differs")
    return {"verified": True, "artifact_count": len(artifacts)}


def handler(event, _context):
    try:
        raw = event.get("body") or ""
        if event.get("isBase64Encoded"):
            import base64
            raw = base64.b64decode(raw).decode()
        if len(raw) > 8192:
            return reply(413, {"error": "Request too large"})
        secret = os.environ["RICEGUARD_DISPATCH_SECRET"].encode()
        headers = {key.lower(): value for key, value in (event.get("headers") or {}).items()}
        actual = headers.get("x-riceguard-signature", "")
        expected = hmac.new(secret, raw.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(actual, expected):
            return reply(401, {"error": "Unauthorized"})
        body = json.loads(raw)
        if not re.fullmatch(r"[0-9a-f-]{36}", body.get("job_id", ""), re.IGNORECASE):
            raise ValueError("Invalid job identifier")
        action = body.get("action")
        if action == "submit":
            if not isinstance(body.get("worker_token"), str) or len(body["worker_token"]) < 32:
                raise ValueError("Worker token required")
            result = submit(body)
            return reply(429 if result.get("code") else 200, result)
        if action == "status":
            return reply(200, status(body))
        if action == "signed-review":
            return reply(200, signed_review(body))
        if action == "signed-pinned-review":
            return reply(200, signed_pinned_review(body))
        if action == "signed-pinned-models":
            return reply(200, signed_pinned_models(body))
        if action == "verify-pinned-artifacts":
            return reply(200, verify_pinned_artifacts(body))
        if action == "signed-pinned-uploads":
            return reply(200, signed_pinned_uploads(body))
        return reply(400, {"error": "Unsupported action"})
    except (KeyError, ValueError) as error:
        return reply(400, {"error": str(error)[:200]})
    except Exception:
        # Internal details stay in CloudWatch; no credentials or object paths
        # are returned to untrusted callers.
        import traceback
        traceback.print_exc()
        return reply(503, {"error": "Private inference control plane unavailable"})
