"""One explicit private tile smoke test. No publication or website activation."""
import argparse
import hashlib
import io
import json
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
import numpy as np
from PIL import Image

from deploy_worker import ACCOUNT, BUCKET, NAME, PREFIX, REGION

RUN = "smoke-20260928-photo-01"
session = boto3.Session(region_name=REGION)
s3 = session.client("s3")
batch = session.client("batch")


def main(action, source, retry_failed=False):
    if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise RuntimeError("Wrong account")
    receipt_key = f"{PREFIX}/jobs/{RUN}/submission.json"
    if action == "submit":
        try:
            receipt = json.loads(s3.get_object(Bucket=BUCKET, Key=receipt_key)["Body"].read())
            previous = batch.describe_jobs(jobs=[receipt["job_id"]])["jobs"][0]
            if not retry_failed or previous["status"] != "FAILED":
                print(json.dumps({"status": "already_submitted", **receipt}))
                return
            s3.put_object(Bucket=BUCKET, Key=f"{PREFIX}/jobs/{RUN}/attempt-{receipt['job_id']}.json",
                          Body=json.dumps(receipt).encode(), ServerSideEncryption="AES256")
        except ClientError as error:
            if error.response["Error"]["Code"] != "NoSuchKey":
                raise
        if session.client("freetier").get_account_plan_state()["accountPlanRemainingCredits"]["amount"] < 20:
            raise RuntimeError("Insufficient credit reserve")
        for state in ("SUBMITTED", "PENDING", "RUNNABLE", "STARTING", "RUNNING"):
            if batch.list_jobs(jobQueue=NAME, jobStatus=state)["jobSummaryList"]:
                raise RuntimeError("Another job is active; no duplicate smoke run")
        path = Path(source).resolve()
        if not path.is_file():
            raise ValueError("Source image required")
        with Image.open(path) as image:
            if image.size != (1024, 1024):
                raise ValueError("Smoke input must be one existing 1024 tile")
        data = path.read_bytes()
        source_key = f"{PREFIX}/jobs/{RUN}/inputs/photo.jpg"
        s3.put_object(Bucket=BUCKET, Key=source_key, Body=data, ServerSideEncryption="AES256")
        manifest = {"kind": "photo_batch", "run_id": RUN, "assets": [{"id": "photo", "key": source_key,
                    "sha256": hashlib.sha256(data).hexdigest()}]}
        body = json.dumps(manifest, sort_keys=True).encode()
        digest = hashlib.sha256(body).hexdigest()
        key = f"{PREFIX}/jobs/{RUN}/manifest.json"
        s3.put_object(Bucket=BUCKET, Key=key, Body=body, ServerSideEncryption="AES256", ContentType="application/json")
        result = batch.submit_job(jobName=RUN, jobQueue=NAME, jobDefinition=NAME,
            containerOverrides={"environment": [{"name": "RICEGUARD_MANIFEST_KEY", "value": key},
                {"name": "RICEGUARD_MANIFEST_SHA256", "value": digest}]},
            timeout={"attemptDurationSeconds": 600}, retryStrategy={"attempts": 1}, tags={"Project": "RiceGuard", "Purpose": "smoke-test"})
        receipt = {"job_id": result["jobId"], "manifest_sha256": digest, "source": path.name, "maximum_run_seconds": 600}
        s3.put_object(Bucket=BUCKET, Key=receipt_key, Body=json.dumps(receipt).encode(), ServerSideEncryption="AES256")
        print(json.dumps(receipt))
        return
    receipt = json.loads(s3.get_object(Bucket=BUCKET, Key=receipt_key)["Body"].read())
    job = batch.describe_jobs(jobs=[receipt["job_id"]])["jobs"][0]
    print(json.dumps({"job_id": job["jobId"], "status": job["status"], "reason": job.get("statusReason"),
                      "started_at": job.get("startedAt"), "stopped_at": job.get("stoppedAt"),
                      "log_stream": job.get("container", {}).get("logStreamName")}))
    if job["status"] != "SUCCEEDED":
        return
    prefix = f"{PREFIX}/jobs/{RUN}/outputs/{receipt['manifest_sha256']}"
    result = json.loads(s3.get_object(Bucket=BUCKET, Key=f"{prefix}/result.json")["Body"].read())
    assert result["status"] == "needs_review" and result["website_activation"] is False
    assert result["source_manifest_sha256"] == receipt["manifest_sha256"]
    asset = result["assets"][0]
    assert (asset["width"], asset["height"]) == (1024, 1024)
    assert {d["disease"] for d in asset["diseases"]} == {"BLB", "Brown Spot"}
    assert asset["severity"] is None
    for finding in asset["diseases"]:
        data = s3.get_object(Bucket=BUCKET, Key=finding["mask_path"])["Body"].read()
        with Image.open(io.BytesIO(data)) as mask:
            assert mask.size == (1024, 1024)
            assert int((np.asarray(mask) == 255).sum()) == finding["predicted_pixels"]
    for media in asset["media"]:
        data = s3.get_object(Bucket=BUCKET, Key=media["key"])["Body"].read()
        with Image.open(io.BytesIO(data)) as image:
            assert image.size == (1024, 1024) and not image.getexif()
    print(json.dumps({"verified": "both masks and four native sanitized private review images",
        "seconds": result["seconds"], "findings": asset["diseases"], "website_active": False}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("submit", "status"))
    parser.add_argument("--source")
    parser.add_argument("--retry-failed", action="store_true")
    args = parser.parse_args()
    main(args.action, args.source, args.retry_failed)
