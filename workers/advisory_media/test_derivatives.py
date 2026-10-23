"""Synthetic, local-only regression tests for advisory image derivatives."""

import hashlib
import random
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, PngImagePlugin

from workers.advisory_media.derivatives import build_derivatives, build_detail_crop


ASSET_ID = "bd614051-cbc6-4d7f-8b5c-da71a15fc779"


class DerivativeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def source(self, size=(600, 400), suffix=".jpg"):
        path = self.root / ("source" + suffix)
        Image.new("RGB", size, (21, 138, 63)).save(path)
        return path

    def digest(self, path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def build(self, source, output="derivatives", **kwargs):
        return build_derivatives(
            source, self.root / output,
            source_sha256=kwargs.pop("source_sha256", self.digest(source)),
            source_asset_id=kwargs.pop("source_asset_id", ASSET_ID),
            variant=kwargs.pop("variant", "original"), **kwargs,
        )

    def assert_receipt(self, receipt, path, maximum=2048):
        self.assertEqual(receipt["bytes"], path.stat().st_size)
        self.assertLessEqual(receipt["bytes"], 768 * 1024)
        self.assertEqual(receipt["sha256"], self.digest(path))
        self.assertEqual(receipt["file"], path.name)
        with Image.open(path) as image:
            self.assertEqual(image.format, "JPEG")
            self.assertEqual(image.mode, "RGB")
            self.assertEqual(image.size, (receipt["width"], receipt["height"]))
            self.assertLessEqual(max(image.size), maximum)
            self.assertFalse(image.getexif())
            for key in ("exif", "icc_profile", "comment", "xmp", "XML:com.adobe.xmp"):
                self.assertNotIn(key, image.info)

    def test_exif_transpose_metadata_removed_and_source_unchanged(self):
        source = self.source((600, 400))
        exif = Image.Exif()
        exif[274] = 6
        exif[305] = "private device"
        exif[37510] = b"private comment"
        exif[34853] = {1: "N", 2: (14.0, 0.0, 0.0), 3: "E", 4: (121.0, 0.0, 0.0)}
        Image.new("RGB", (600, 400), "green").save(source, exif=exif, icc_profile=b"private profile")
        original = source.read_bytes()
        result = self.build(source)
        self.assertEqual(result["schema_version"], "riceguard.advisory.derivative.v1")
        self.assertEqual(result["source_asset_id"], ASSET_ID)
        self.assertEqual(result["variant"], "original")
        self.assertEqual(result["source_sha256"], self.digest(source))
        self.assertEqual(result["source_dimensions"], {"width": 400, "height": 600})
        self.assertEqual((result["overview"]["width"], result["overview"]["height"]), (400, 600))
        self.assert_receipt(result["overview"], self.root / "derivatives" / result["overview"]["file"])
        self.assertEqual(source.read_bytes(), original)
        self.assertNotIn(str(self.root), str(result))

    def test_png_alpha_palette_and_text_are_safely_rgb_converted(self):
        for mode, color in (("RGBA", (1, 2, 3, 127)), ("P", 1)):
            with self.subTest(mode=mode):
                source = self.root / (mode + ".png")
                metadata = PngImagePlugin.PngInfo()
                metadata.add_text("GPS", "private coordinates")
                Image.new(mode, (120, 80), color).save(source, pnginfo=metadata)
                result = self.build(source, output=mode, variant="combined")
                self.assert_receipt(result["overview"], self.root / mode / "overview.jpg")

    def test_large_noisy_image_is_bounded_without_tiny_geometry(self):
        source = self.root / "noise.png"
        pixels = random.Random(12).randbytes(3200 * 2400 * 3)
        Image.frombytes("RGB", (3200, 2400), pixels).save(source)
        result = self.build(source)
        overview = result["overview"]
        self.assert_receipt(overview, self.root / "derivatives" / "overview.jpg")
        self.assertGreaterEqual(max(overview["width"], overview["height"]), 1024)
        self.assertGreaterEqual(overview["quality"], 50)
        self.assertLessEqual(overview["quality"], 85)
        self.assertAlmostEqual(overview["width"] / overview["height"], 4 / 3, places=2)

    def test_output_is_deterministic_and_small_sources_are_not_upscaled(self):
        source = self.source((97, 51))
        first = self.build(source, "one")
        second = self.build(source, "two")
        self.assertEqual(first, second)
        self.assertEqual((self.root / "one/overview.jpg").read_bytes(), (self.root / "two/overview.jpg").read_bytes())
        self.assertEqual((first["overview"]["width"], first["overview"]["height"]), (97, 51))
        self.assertEqual(first["overview"]["quality"], 85)

    def test_impossible_cap_fails_without_shrinking_below_floor(self):
        source = self.source((2100, 1400))
        with patch("workers.advisory_media.derivatives.MAX_DERIVATIVE_BYTES", 1):
            with self.assertRaisesRegex(ValueError, "quality and geometry floors"):
                self.build(source)
        self.assertFalse((self.root / "derivatives").exists())

    def test_digest_verified_before_image_decode(self):
        source = self.source()
        with patch("workers.advisory_media.derivatives.Image.open") as decoder:
            with self.assertRaises(ValueError):
                self.build(source, source_sha256="0" * 64)
            decoder.assert_not_called()
        self.assertFalse((self.root / "derivatives").exists())

    def test_malformed_and_unsupported_images_fail_without_output(self):
        corrupt = self.root / "corrupt.jpg"
        corrupt.write_bytes(b"not an image")
        for source in (corrupt, self.root / "animation.gif"):
            if source.suffix == ".gif":
                Image.new("RGB", (10, 10)).save(source)
            with self.subTest(source=source.name), self.assertRaises(ValueError):
                self.build(source)
            self.assertFalse((self.root / "derivatives").exists())

    def test_invalid_identifiers_and_digest_format(self):
        source = self.source()
        for kwargs in ({"source_asset_id": "not-uuid"}, {"variant": "mask"}, {"source_sha256": "a"}, {"source_sha256": "Z" * 64}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.build(source, **kwargs)

    def test_existing_output_directory_and_file_are_never_overwritten(self):
        source = self.source()
        directory = self.root / "existing"
        directory.mkdir()
        marker = directory / "keep.txt"
        marker.write_text("keep")
        file = self.root / "existing-file"
        file.write_text("keep")
        for output in (directory, file):
            with self.subTest(output=output.name), self.assertRaises(FileExistsError):
                self.build(source, output=output.name)
        self.assertEqual(marker.read_text(), "keep")
        self.assertEqual(file.read_text(), "keep")

    def test_nonfile_source_rejected(self):
        for source in (self.root, self.root / "missing.jpg"):
            with self.subTest(source=source.name), self.assertRaises((ValueError, OSError)):
                self.build(source, source_sha256="0" * 64)

    def test_symlink_source_and_output_are_rejected(self):
        source = self.source()
        link = self.root / "source-link.jpg"
        try:
            link.symlink_to(source)
        except OSError as error:
            self.skipTest("Host cannot create symlinks: " + str(error))
        with self.assertRaises(ValueError):
            self.build(link)
        output = self.root / "linked-output"
        output.symlink_to(self.root / "missing-target", target_is_directory=True)
        with self.assertRaises((ValueError, FileExistsError)):
            self.build(source, output=output.name)
        parent = self.root / "linked-parent"
        parent.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.build(source, output="linked-parent/new")

    def test_source_byte_and_pixel_limits_checked_before_decode(self):
        source = self.source((60, 40))
        with patch("workers.advisory_media.derivatives.MAX_SOURCE_BYTES", 10):
            with self.assertRaises(ValueError):
                self.build(source)
        with patch("workers.advisory_media.derivatives.MAX_SOURCE_PIXELS", 2000):
            with self.assertRaises(ValueError):
                self.build(source)
        self.assertFalse((self.root / "derivatives").exists())

    def test_crop_is_bounded_labeled_and_metadata_free(self):
        source = self.source((1400, 1200))
        output = self.root / "detail.jpg"
        result = build_detail_crop(source, output, source_sha256=self.digest(source), source_asset_id=ASSET_ID, variant="combined", box=(100, 120, 1124, 1144))
        self.assertEqual(result["schema_version"], "riceguard.advisory.detail.v1")
        self.assertEqual(result["source_asset_id"], ASSET_ID)
        self.assertEqual(result["variant"], "combined")
        self.assertEqual(result["source_sha256"], self.digest(source))
        self.assertEqual(result["box"], [100, 120, 1124, 1144])
        self.assertEqual(result["source_dimensions"], {"width": 1400, "height": 1200})
        self.assert_receipt(result["detail"], output, maximum=1024)
        self.assertEqual((result["detail"]["width"], result["detail"]["height"]), (1024, 1024))
        with self.assertRaises(FileExistsError):
            build_detail_crop(source, output, source_sha256=self.digest(source), source_asset_id=ASSET_ID, variant="combined", box=(0, 0, 10, 10))

    def test_crop_rejects_invalid_or_oversized_boxes(self):
        source = self.source((1400, 1200))
        boxes = ((-1, 0, 10, 10), (0, 0, 0, 10), (10, 0, 5, 10), (0, 0, 1401, 10), (0, 0, 1025, 10), (0, 0, 10, 1025), (0.0, 0, 10, 10), (False, 0, 10, 10), (0, 0, 10))
        for box in boxes:
            with self.subTest(box=box), self.assertRaises(ValueError):
                build_detail_crop(source, self.root / "detail.jpg", source_sha256=self.digest(source), source_asset_id=ASSET_ID, variant="original", box=box)
        self.assertFalse((self.root / "detail.jpg").exists())


if __name__ == "__main__":
    unittest.main()
