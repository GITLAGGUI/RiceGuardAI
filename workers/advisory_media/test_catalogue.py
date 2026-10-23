"""Local synthetic manifest-to-catalogue contract tests."""

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest
from uuid import UUID

from PIL import Image

from workers.advisory_media.catalogue import build_catalogue


SURVEY_ID = "11111111-1111-4111-8111-111111111111"
JOB_ID = "22222222-2222-4222-8222-222222222222"
RUN_ID = "rg-catalogue-fixture-20261023"
PREFIX = f"website-inference/v2/jobs/{RUN_ID}/outputs/"


class CatalogueTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def fixture(self, count=1, video=False):
        manifest = {"schema_version": "riceguard.result.v2", "run_id": RUN_ID,
                    "assets": [], "artifacts": {}, "private_native_field": {"untouched": True}}
        local = {}
        for index in range(count):
            asset_id = str(UUID(int=index + 1))
            asset = {"source_asset_id": asset_id, "kind": "image", "status": "complete",
                     "width": 48, "height": 32, "review_paths": {}}
            for variant in ("original", "combined"):
                key = PREFIX + f"{asset_id}/{variant}.jpg"
                path = self.root / f"native-{index}-{variant}.jpg"
                Image.new("RGB", (48, 32), (index * 10, 100, 70)).save(path)
                blob = path.read_bytes()
                manifest["artifacts"][key] = {"sha256": sha256(blob).hexdigest(), "bytes": len(blob)}
                asset["review_paths"][variant] = key
                local[key] = path
            manifest["assets"].append(asset)
            if video and index in (0, count - 1):
                manifest["assets"].append({"kind": "video", "source_asset_id": str(UUID(int=100 + index)),
                                           "status": "complete", "review_paths": {"video": PREFIX + "ignored.mp4"}})
        return manifest, local

    def build(self, manifest, local, name="output", **kwargs):
        return build_catalogue(manifest, local, self.root / name,
                               survey_id=kwargs.pop("survey_id", SURVEY_ID),
                               job_id=kwargs.pop("job_id", JOB_ID),
                               result_revision=kwargs.pop("result_revision", 3), **kwargs)

    def assert_preflight_failure(self, manifest, local, error=(ValueError, OSError)):
        with self.assertRaises(error):
            self.build(manifest, local)
        self.assertFalse((self.root / "output").exists())

    def test_one_four_ten_photos_and_interleaved_video(self):
        for count in (1, 4, 10):
            with self.subTest(count=count):
                manifest, local = self.fixture(count, video=True)
                original = deepcopy(manifest)
                native_bytes = {key: path.read_bytes() for key, path in local.items()}
                catalogue, uploads = self.build(manifest, local, name=f"output-{count}")
                self.assertEqual(catalogue["schema_version"], "riceguard.advisory.catalogue.v1")
                self.assertEqual(catalogue["policy_version"], "visual-v1")
                self.assertEqual(catalogue["survey_id"], SURVEY_ID)
                self.assertEqual(catalogue["job_id"], JOB_ID)
                self.assertEqual(catalogue["result_revision"], 3)
                self.assertEqual(len(catalogue["entries"]), count * 2)
                self.assertEqual(len(uploads), count * 2)
                self.assertEqual([entry["image_index"] for entry in catalogue["entries"]], [i for i in range(1, count + 1) for _ in range(2)])
                for entry in catalogue["entries"]:
                    asset_id, variant = entry["source_asset_id"], entry["variant"]
                    target = PREFIX + f"advisory-media/visual-v1/{asset_id}/{variant}.jpg"
                    self.assertEqual(entry["path"], target)
                    self.assertEqual(uploads[target], self.root / f"output-{count}/{asset_id}/{variant}/overview.jpg")
                    encoded = uploads[target].read_bytes()
                    self.assertEqual(entry["sha256"], sha256(encoded).hexdigest())
                    self.assertEqual(entry["bytes"], len(encoded))
                    self.assertEqual(entry["source_sha256"], manifest["artifacts"][PREFIX + f"{asset_id}/{variant}.jpg"]["sha256"])
                    self.assertEqual((entry["width"], entry["height"], entry["quality"]), (48, 32, 85))
                self.assertNotIn(str(self.root), json.dumps(catalogue))
                self.assertEqual(manifest, original)
                self.assertEqual(native_bytes, {key: path.read_bytes() for key, path in local.items()})

    def test_invalid_schema_run_identity_and_revision(self):
        for field, value in (("schema_version", "riceguard.result.v1"), ("run_id", "rg-../bad"), ("run_id", "rg-short"), ("run_id", "rg-" + "a" * 81)):
            with self.subTest(field=field, value=value):
                manifest, local = self.fixture()
                manifest[field] = value
                self.assert_preflight_failure(manifest, local)
        for kwargs in ({"survey_id": "bad"}, {"job_id": "bad"}, {"result_revision": 0}, {"result_revision": True}, {"result_revision": 1.5}):
            manifest, local = self.fixture()
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.build(manifest, local, **kwargs)
            self.assertFalse((self.root / "output").exists())

    def test_photo_count_duplicate_and_invalid_asset_ids(self):
        for count in (0, 11):
            manifest, local = self.fixture(count)
            self.assert_preflight_failure(manifest, local)
        for value in ("not-a-uuid", None):
            manifest, local = self.fixture()
            manifest["assets"][0]["source_asset_id"] = value
            self.assert_preflight_failure(manifest, local)
        manifest, local = self.fixture(2)
        manifest["assets"][1]["source_asset_id"] = manifest["assets"][0]["source_asset_id"]
        self.assert_preflight_failure(manifest, local)

    def test_missing_variant_artifact_mapping_and_local_file(self):
        for failure in ("variant", "receipt", "mapping", "file"):
            with self.subTest(failure=failure):
                manifest, local = self.fixture(2)
                key = manifest["assets"][-1]["review_paths"]["combined"]
                if failure == "variant":
                    del manifest["assets"][-1]["review_paths"]["combined"]
                elif failure == "receipt":
                    del manifest["artifacts"][key]
                elif failure == "mapping":
                    del local[key]
                else:
                    local[key].unlink()
                self.assert_preflight_failure(manifest, local)

    def test_malformed_receipts_and_actual_hash_or_byte_mismatch(self):
        for receipt in ({"sha256": "bad", "bytes": 1}, {"sha256": "a" * 64, "bytes": 0}, {"sha256": "a" * 64, "bytes": True}, {"sha256": "a" * 64, "bytes": 201 * 1024 * 1024}, None):
            manifest, local = self.fixture()
            key = next(iter(local))
            manifest["artifacts"][key] = receipt
            self.assert_preflight_failure(manifest, local)
        for field, value in (("sha256", "0" * 64), ("bytes", 1)):
            manifest, local = self.fixture(2)
            key = list(local)[-1]
            manifest["artifacts"][key][field] = value
            self.assert_preflight_failure(manifest, local)

    def test_unsafe_object_paths_never_create_output(self):
        paths = ("../source.jpg", PREFIX + "../source.jpg", "/absolute.jpg", "C:/image.jpg",
                 PREFIX + "bad\\image.jpg", PREFIX + "bad%2fimage.jpg", PREFIX + "image.jpg?token=secret",
                 PREFIX + "./image.jpg", PREFIX + "//image.jpg", "https://example.com/image.jpg")
        for unsafe in paths:
            with self.subTest(path=unsafe):
                manifest, local = self.fixture()
                old = manifest["assets"][0]["review_paths"]["original"]
                manifest["assets"][0]["review_paths"]["original"] = unsafe
                manifest["artifacts"][unsafe] = manifest["artifacts"][old]
                local[unsafe] = local[old]
                self.assert_preflight_failure(manifest, local)

    def test_corrupt_late_source_is_preflighted_before_any_output(self):
        manifest, local = self.fixture(4)
        key = list(local)[-1]
        local[key].write_bytes(b"corrupt image with a valid receipt")
        blob = local[key].read_bytes()
        manifest["artifacts"][key] = {"sha256": sha256(blob).hexdigest(), "bytes": len(blob)}
        self.assert_preflight_failure(manifest, local)

    def test_existing_output_is_preserved(self):
        manifest, local = self.fixture()
        output = self.root / "output"
        output.mkdir()
        marker = output / "keep.txt"
        marker.write_text("untouched")
        with self.assertRaises(FileExistsError):
            self.build(manifest, local)
        self.assertEqual(marker.read_text(), "untouched")
        self.assertEqual(list(output.iterdir()), [marker])

    def test_source_and_output_symlinks_rejected(self):
        manifest, local = self.fixture()
        key = next(iter(local))
        link = self.root / "native-link.jpg"
        try:
            link.symlink_to(local[key])
        except OSError as error:
            self.skipTest(str(error))
        actual = local[key]
        local[key] = link
        self.assert_preflight_failure(manifest, local)
        local[key] = actual
        output = self.root / "output"
        output.symlink_to(self.root / "absent", target_is_directory=True)
        with self.assertRaises((ValueError, FileExistsError)):
            self.build(manifest, local)
        self.assertTrue(output.is_symlink())
        self.assertFalse((self.root / "absent").exists())


if __name__ == "__main__":
    unittest.main()
