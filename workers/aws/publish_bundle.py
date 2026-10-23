"""Upload only hash-pinned specialist artifacts to existing private AWS storage."""
import hashlib
import json
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[3]
BUCKET = "riceguard-l40s-78407276-20260824"
PREFIX = "website-inference/v2"
MODELS = {
    "BLB": ("training_runs/blb_yolo26m_semantic_20260925/kaggle_output/riceguard_blb_yolo26m_semantic/artifacts/blb_yolo26m_semantic_fold_a_best.pt",
            "aa10d1f6c03baf189c56484db99e96ba55c646be1668d102bdaed78a43315bc6", "disease_region"),
    "Brown Spot": ("training_runs/brownspot_yolo26m_semantic_20260924/kaggle_recovery_output/riceguard_brownspot_yolo26m_semantic_recovery/artifacts/brownspot_yolo26m_semantic_best.pt",
                   "58a1f4600887577749a22f7a8b43b81174bb082d68afd5f09f1079b79a18bca5", "affected_leaf"),
}


def main():
    session = boto3.Session(region_name="us-east-1")
    if session.client("sts").get_caller_identity()["Account"] != "342278407276":
        raise RuntimeError("Unexpected account")
    s3 = session.client("s3")
    flags = s3.get_public_access_block(Bucket=BUCKET)["PublicAccessBlockConfiguration"]
    if not all(flags.values()) or len(flags) != 4:
        raise RuntimeError("Public access must be fully blocked")
    acl = s3.get_bucket_acl(Bucket=BUCKET)
    if any(g["Grantee"].get("ID") != acl["Owner"]["ID"] for g in acl["Grants"]):
        raise RuntimeError("Unexpected bucket sharing")
    bundle = {"id": "riceguard-yolo26m-semantic-20260928", "activated": False,
              "provider": "aws", "ultralytics_version": "8.4.115", "models": {}}
    for disease, (relative, expected, meaning) in MODELS.items():
        path = ROOT / relative
        with path.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != expected:
            raise RuntimeError(f"Checkpoint hash mismatch: {disease}")
        key = f"{PREFIX}/models/{expected}.pt"
        try:
            existing = s3.head_object(Bucket=BUCKET, Key=key)
        except ClientError as error:
            if error.response["Error"]["Code"] not in ("404", "NoSuchKey"):
                raise
            s3.upload_file(str(path), BUCKET, key, ExtraArgs={"ServerSideEncryption": "AES256",
                "Metadata": {"sha256": expected}, "ContentType": "application/octet-stream"})
            existing = s3.head_object(Bucket=BUCKET, Key=key)
        if existing["ContentLength"] != path.stat().st_size or existing.get("Metadata", {}).get("sha256") != expected:
            raise RuntimeError("Uploaded object verification failed")
        bundle["models"][disease] = {"bucket": BUCKET, "key": key, "sha256": expected,
            "bytes": existing["ContentLength"], "foreground_class_id": 1, "mask_meaning": meaning,
            "input_size": 1024, "stride": 768, "stitching": "binary_class_map_majority_vote_ties_foreground",
            "preprocessing": "ultralytics_pil_rgb_letterbox", "architecture": "yolo26m-semantic"}
        print(json.dumps({"model": disease, "private_upload_verified": True, "bytes": existing["ContentLength"]}), flush=True)
    body = json.dumps(bundle, sort_keys=True, indent=2).encode()
    bundle_hash = hashlib.sha256(body).hexdigest()
    key = f"{PREFIX}/bundles/{bundle_hash}.json"
    s3.put_object(Bucket=BUCKET, Key=key, Body=body, ContentType="application/json", ServerSideEncryption="AES256")
    if s3.get_object(Bucket=BUCKET, Key=key)["Body"].read() != body:
        raise RuntimeError("Bundle verification failed")
    print(json.dumps({"bundle_key": key, "sha256": bundle_hash, "activated": False}))


if __name__ == "__main__":
    main()
