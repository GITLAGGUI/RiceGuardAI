"""One-time private v2 contract smoke using the previously verified test tile.

It does not submit a website job, publish media, or touch CVAT. The receipt
prevents accidental repeat submission; use status for subsequent inspection.
"""

import argparse
import hashlib
import json

import boto3
from botocore.exceptions import ClientError

from deploy_worker import ACCOUNT, BUCKET, NAME, PREFIX, REGION

RUN = "smoke-20260928-v2-01"
ASSET = "11111111-1111-4111-8111-111111111111"
session = boto3.Session(region_name=REGION)
s3 = session.client("s3")
batch = session.client("batch")


def get(key):
    return s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()


def submit():
    receipt_key = f"{PREFIX}/jobs/{RUN}/submission.json"
    try:
        receipt = json.loads(get(receipt_key))
        print(json.dumps({"already_submitted": True, "job_id": receipt["job_id"]}))
        return
    except ClientError as error:
        if error.response["Error"]["Code"] != "NoSuchKey":
            raise
    if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise RuntimeError("Wrong AWS account")
    if session.client("freetier").get_account_plan_state()["accountPlanRemainingCredits"]["amount"] < 20:
        raise RuntimeError("Credit reserve too low")
    for state in ("SUBMITTED", "PENDING", "RUNNABLE", "STARTING", "RUNNING"):
        if batch.list_jobs(jobQueue=NAME, jobStatus=state)["jobSummaryList"]:
            raise RuntimeError("Another worker job is active")
    source = get(f"{PREFIX}/jobs/smoke-20260928-photo-01/inputs/photo.jpg")
    source_key = f"{PREFIX}/jobs/{RUN}/inputs/{ASSET}.jpg"
    s3.put_object(Bucket=BUCKET, Key=source_key, Body=source, ServerSideEncryption="AES256")
    manifest = {"kind": "photo_batch", "run_id": RUN, "source_manifest_hash": "f" * 64,
                "assets": [{"id": ASSET, "key": source_key, "sha256": hashlib.sha256(source).hexdigest()}]}
    body = json.dumps(manifest, sort_keys=True).encode()
    digest = hashlib.sha256(body).hexdigest()
    key = f"{PREFIX}/jobs/{RUN}/manifest.json"
    s3.put_object(Bucket=BUCKET, Key=key, Body=body, ServerSideEncryption="AES256", ContentType="application/json")
    job = batch.submit_job(jobName=RUN, jobQueue=NAME, jobDefinition=f"{NAME}:3",
        containerOverrides={"environment": [{"name": "RICEGUARD_MANIFEST_KEY", "value": key},
            {"name": "RICEGUARD_MANIFEST_SHA256", "value": digest}]},
        timeout={"attemptDurationSeconds": 600}, retryStrategy={"attempts": 1},
        tags={"Project": "RiceGuard", "Purpose": "v2-contract-smoke"})
    receipt = {"job_id": job["jobId"], "manifest_sha256": digest}
    s3.put_object(Bucket=BUCKET, Key=receipt_key, Body=json.dumps(receipt).encode(), ServerSideEncryption="AES256")
    print(json.dumps({"submitted": True, **receipt}))


def status():
    receipt = json.loads(get(f"{PREFIX}/jobs/{RUN}/submission.json"))
    job = batch.describe_jobs(jobs=[receipt["job_id"]])["jobs"][0]
    result = {"job_id": job["jobId"], "status": job["status"], "reason": job.get("statusReason")}
    if job["status"] == "SUCCEEDED":
        key = f"{PREFIX}/jobs/{RUN}/outputs/{receipt['manifest_sha256']}/website-result.json"
        v2 = json.loads(get(key))
        assert v2["schema_version"] == "riceguard.result.v2"
        assert v2["source_manifest_hash"] == "f" * 64
        assert {d["disease"] for d in v2["assets"][0]["diseases"]} == {"BLB", "Brown Spot"}
        assert len(v2["media"]) == 4 and all(m["sanitized"] for m in v2["media"])
        assert v2["severity"]["value"] is None
        result["verified"] = "private v2 result, two masks, four native sanitized review media"
    print(json.dumps(result))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("submit", "status"))
    args = parser.parse_args()
    {"submit": submit, "status": status}[args.action]()
