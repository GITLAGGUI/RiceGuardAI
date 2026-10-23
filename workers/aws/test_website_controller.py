"""No-cloud control-plane contract tests; no AWS job or billing side effect."""

import hashlib
import hmac
import json
import os
import base64
import io
import unittest
from unittest.mock import patch

from website_controller import handler, verify_meta, verify_pinned_artifacts, signed_pinned_uploads, signed_pinned_review, signed_pinned_models, BUNDLE_SHA256, PREFIX


class ControllerTests(unittest.TestCase):
    def test_unsigned_request_rejected_before_aws(self):
        os.environ["RICEGUARD_DISPATCH_SECRET"] = "test-only-secret"
        response = handler({"body": '{"action":"status"}', "headers": {}}, None)
        self.assertEqual(response["statusCode"], 401)

    def test_wrong_job_id_rejected_after_signature(self):
        secret = "test-only-secret"
        os.environ["RICEGUARD_DISPATCH_SECRET"] = secret
        body = json.dumps({"action": "status", "job_id": "not-a-uuid", "run_id": "smoke"})
        signature = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
        response = handler({"body": body, "headers": {"X-RiceGuard-Signature": signature}}, None)
        self.assertEqual(response["statusCode"], 400)

    def test_unverified_source_rejected(self):
        body = {"job_id": "11111111-1111-4111-8111-111111111111", "run_id": "rg-one"}
        meta = {"job_id": body["job_id"], "run_id": body["run_id"], "pinned_bundle_sha256": BUNDLE_SHA256,
            "source_manifest_hash": "a" * 64, "source_manifest": {"execution_provider": "aws",
                "assets": [{"id": "22222222-2222-4222-8222-222222222222", "state": "Uploading",
                    "mime": "image/jpeg", "bytes": 1024, "checksum": "b" * 64, "drive_file_id": "verified_file_123"}]}}
        with self.assertRaises(ValueError):
            verify_meta(meta, body)

    def test_pinned_artifacts_require_matching_private_head_metadata(self):
        key = f"{PREFIX}/jobs/rg-test-12345678/outputs/{'f' * 64}/photos/one/blb.png"
        receipt = {"sha256": "a" * 64, "bytes": 100}
        body = {"run_id": "rg-test-12345678", "artifacts": {f"{key}-{index}": receipt for index in range(6)}}
        with patch("website_controller.s3") as storage:
            checksum = base64.b64encode(bytes.fromhex("a" * 64)).decode("ascii")
            storage.head_object.return_value = {"ContentLength": 100, "ChecksumSHA256": checksum}
            self.assertEqual(verify_pinned_artifacts(body)["artifact_count"], 6)
            storage.head_object.return_value = {"ContentLength": 99, "ChecksumSHA256": checksum}
            with self.assertRaisesRegex(ValueError, "checksum"):
                verify_pinned_artifacts(body)
            storage.head_object.assert_called()
        with patch("website_controller.presign_s3") as signer:
            signer.generate_presigned_url.return_value = "https://private.example.invalid/signed"
            self.assertEqual(len(signed_pinned_uploads(body)["private_uploads"]), 6)
            self.assertEqual(signer.generate_presigned_url.call_count, 6)
        body["artifacts"] = {key.replace("/outputs/", "/other/"): receipt for _ in range(6)}
        with self.assertRaises(ValueError):
            verify_pinned_artifacts(body)

    def test_signed_pinned_review_rejects_unrelated_or_duplicate_keys(self):
        key = f"{PREFIX}/jobs/rg-test-12345678/outputs/{'f' * 64}/video/review.mp4"
        with patch("website_controller.s3") as storage:
            storage.generate_presigned_url.return_value = "https://private.example.invalid/review"
            self.assertEqual(signed_pinned_review({"run_id": "rg-test-12345678", "paths": [key]})[key],
                             "https://private.example.invalid/review")
        for paths in ([key, key], [key.replace("rg-test-12345678", "rg-other-12345678")], [key + ".png"]):
            with self.assertRaises(ValueError):
                signed_pinned_review({"run_id": "rg-test-12345678", "paths": paths})

    def test_signed_pinned_review_supports_ten_photos_and_one_video(self):
        prefix = f"{PREFIX}/jobs/rg-test-12345678/outputs/{'f' * 64}/review"
        paths = [f"{prefix}/photo-{index:02d}-{variant}.jpg"
                 for index in range(10) for variant in ("original", "blb", "brown", "combined")]
        paths.append(f"{prefix}/video.mp4")
        with patch("website_controller.s3") as storage:
            storage.generate_presigned_url.return_value = "https://private.example.invalid/review"
            self.assertEqual(len(signed_pinned_review({"run_id": "rg-test-12345678", "paths": paths})), 41)
        with self.assertRaises(ValueError):
            signed_pinned_review({"run_id": "rg-test-12345678", "paths": paths + [f"{prefix}/extra-{i}.jpg" for i in range(4)]})

    def test_final_single_artifact_partition_is_valid(self):
        key = f"{PREFIX}/jobs/rg-test-12345678/outputs/{'f' * 64}/video/publication.mp4"
        receipt = {"sha256": "a" * 64, "bytes": 100}
        body = {"run_id": "rg-test-12345678", "artifacts": {key: receipt}}
        with patch("website_controller.presign_s3") as signer:
            signer.generate_presigned_url.return_value = "https://private.example.invalid/upload"
            self.assertEqual(len(signed_pinned_uploads(body)["private_uploads"]), 1)

    def test_signed_models_are_limited_to_the_two_pinned_private_objects(self):
        expected = {
            "BLB": "aa10d1f6c03baf189c56484db99e96ba55c646be1668d102bdaed78a43315bc6",
            "Brown Spot": "58a1f4600887577749a22f7a8b43b81174bb082d68afd5f09f1079b79a18bca5",
        }
        bundle = {"id": "riceguard-yolo26m-semantic-20260928", "models": {
            disease: {"key": f"{PREFIX}/models/{artifact}.pt", "sha256": artifact,
                      "bytes": 100, "architecture": "yolo26m-semantic"}
            for disease, artifact in expected.items()
        }}
        raw = json.dumps(bundle).encode()
        with patch("website_controller.s3") as storage, patch("website_controller.presign_s3") as signer, \
                patch("website_controller.hashlib.sha256") as sha:
            storage.get_object.return_value = {"Body": io.BytesIO(raw)}
            storage.head_object.return_value = {"ContentLength": 100, "Metadata": {}}
            storage.head_object.side_effect = [
                {"ContentLength": 100, "Metadata": {"sha256": expected["BLB"]}},
                {"ContentLength": 100, "Metadata": {"sha256": expected["Brown Spot"]}},
            ]
            sha.return_value.hexdigest.return_value = BUNDLE_SHA256
            signer.generate_presigned_url.return_value = "https://private.example.invalid/model"
            result = signed_pinned_models({"run_id": "rg-test-12345678"})
            self.assertEqual(set(result["model_downloads"]), set(expected))
            self.assertEqual(signer.generate_presigned_url.call_count, 2)

if __name__ == "__main__":
    unittest.main()
