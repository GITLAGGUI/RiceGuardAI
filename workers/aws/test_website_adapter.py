"""Contract and privacy checks for AWS-to-website photo results."""

import unittest

from website_adapter import BUNDLE_SHA256, to_result_v2


ASSET = "11111111-1111-4111-8111-111111111111"
RUN = "rg-11111111-abc123456789"
AWS_MANIFEST_HASH = "d" * 64
PREFIX = f"website-inference/v2/jobs/{RUN}/outputs/{AWS_MANIFEST_HASH}"


def sample():
    bundle = {"id": "riceguard-yolo26m-semantic-20260928", "models": {}}
    findings = []
    for disease, digest, meaning, count in (
        ("BLB", "a" * 64, "disease_region", 12),
        ("Brown Spot", "b" * 64, "affected_leaf", 25),
    ):
        bundle["models"][disease] = {"sha256": digest, "architecture": "yolo26m-semantic",
            "foreground_class_id": 1, "input_size": 1024, "stride": 768,
            "preprocessing": "ultralytics_pil_rgb_letterbox"}
        findings.append({"disease": disease, "status": "detected", "predicted_pixels": count,
            "mask_meaning": meaning, "mask_path": f"{PREFIX}/{ASSET}/{disease}.png"})
    variants = ("original", "BLB", "Brown Spot", "combined")
    media = [{"variant": variant, "key": f"{PREFIX}/{ASSET}/{variant}.jpg", "width": 1024,
        "height": 1024, "private": True, "sanitized": True} for variant in variants]
    manifest = {"kind": "photo_batch", "run_id": RUN, "source_manifest_hash": "f" * 64,
        "assets": [{"id": ASSET, "key": f"website-inference/v2/jobs/{RUN}/inputs/{ASSET}", "sha256": "0" * 64}]}
    worker = {"schema": "riceguard.aws.photo-worker.v1", "status": "needs_review", "run_id": RUN,
        "bundle_sha256": BUNDLE_SHA256, "source_manifest_sha256": AWS_MANIFEST_HASH,
        "assets": [{"asset_id": ASSET, "width": 1024, "height": 1024,
            "diseases": findings, "media": media, "location": {"source": "missing", "lat": None, "lng": None},
            "capture_time": None, "quality_flags": ["no_verified_location"], "overlap_pixels": 3}]}
    return worker, manifest, bundle


class WebsiteAdapterTests(unittest.TestCase):
    def test_two_independent_masks_and_private_native_media(self):
        result = to_result_v2(*sample())
        self.assertEqual(result["schema_version"], "riceguard.result.v2")
        self.assertEqual({d["disease"] for d in result["assets"][0]["diseases"]}, {"BLB", "Brown Spot"})
        self.assertEqual(result["assets"][0]["ambiguous_overlap_pixels"], 3)
        self.assertEqual(result["severity"]["value"], None)
        self.assertEqual(len(result["media"]), 4)
        self.assertTrue(all(media["sanitized"] and media["width"] == 1024 for media in result["media"]))
        self.assertFalse(any("public" in media["path"] for media in result["media"]))

    def test_wrong_run_rejected(self):
        worker, manifest, bundle = sample()
        worker["run_id"] = "another-run"
        with self.assertRaises(ValueError):
            to_result_v2(worker, manifest, bundle)

    def test_missing_specialist_rejected(self):
        worker, manifest, bundle = sample()
        worker["assets"][0]["diseases"].pop()
        with self.assertRaises(ValueError):
            to_result_v2(worker, manifest, bundle)

    def test_public_or_cross_run_media_rejected(self):
        for change in ({"private": False}, {"key": "website-inference/v2/jobs/other/outputs/a.jpg"}):
            worker, manifest, bundle = sample()
            worker["assets"][0]["media"][0].update(change)
            with self.assertRaises(ValueError):
                to_result_v2(worker, manifest, bundle)

    def test_missing_gps_does_not_become_survey_pin(self):
        worker, manifest, bundle = sample()
        worker["assets"][0]["location"]["lat"] = 17.0
        with self.assertRaises(ValueError):
            to_result_v2(worker, manifest, bundle)

    def test_source_assets_must_match(self):
        worker, manifest, bundle = sample()
        manifest["assets"][0]["id"] = "22222222-2222-4222-8222-222222222222"
        with self.assertRaises(ValueError):
            to_result_v2(worker, manifest, bundle)


if __name__ == "__main__":
    unittest.main()
