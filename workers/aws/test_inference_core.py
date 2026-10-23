import io
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from inference_core import axis_starts, boxes_for, gps_coordinate, inspect_image, overlay, stitch


class InferenceCoreTests(unittest.TestCase):
    def test_native_48mp_has_88_tiles(self):
        self.assertEqual(len(boxes_for(8064, 6048)), 88)
        self.assertEqual(axis_starts(1025), [0, 1])

    def test_every_pixel_is_reconstructed(self):
        image = Image.new("RGB", (1600, 1200))
        mask = stitch(image, lambda t: np.ones((t.height, t.width), dtype=np.uint8))
        self.assertTrue(mask.all())
        self.assertEqual(mask.shape, (1200, 1600))

    def test_failures_are_not_empty_predictions(self):
        with self.assertRaises(ValueError):
            stitch(Image.new("RGB", (10, 10)), lambda t: np.full((10, 10), 255))

    def test_cached_tiles_skip_inference(self):
        result = stitch(Image.new("RGB", (10, 10)), lambda _: self.fail("cache missed"),
                        cache_get=lambda i, shape: np.ones(shape, dtype=bool))
        self.assertTrue(result.all())

    def test_both_diseases_keep_distinct_overlap(self):
        image = Image.new("RGB", (2, 2), "white")
        mask = np.ones((2, 2), dtype=bool)
        both = np.asarray(overlay(image, {"BLB": mask, "Brown Spot": mask}))
        blb = np.asarray(overlay(image, {"BLB": mask}))
        self.assertFalse(np.array_equal(both, blb))

    def test_missing_gps_is_not_a_fabricated_pin(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "photo.jpg"
            exif = Image.Exif()
            exif[274] = 6
            Image.new("RGB", (30, 20)).save(path, exif=exif)
            image, meta = inspect_image(path)
            self.assertEqual(image.size, (20, 30))
            self.assertFalse(image.getexif())
            self.assertIsNone(meta["location"]["lat"])

    def test_equator_is_a_valid_coordinate(self):
        self.assertEqual(gps_coordinate((0, 0, 0), "N", ("N", "S")), 0)
        with self.assertRaises(ValueError):
            gps_coordinate((0, 60, 0), "N", ("N", "S"))

    def test_mpo_jpeg_uses_primary_frame_only(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "drone.jpg"
            Image.new("RGB", (40, 30), "red").save(path, format="MPO", save_all=True,
                append_images=[Image.new("RGB", (40, 30), "blue")])
            image, meta = inspect_image(path)
            self.assertEqual(image.size, (40, 30))
            self.assertGreater(np.asarray(image)[0, 0, 0], np.asarray(image)[0, 0, 2])
            self.assertIn("mpo_primary_image_selected", meta["quality_flags"])

    def test_dji_xmp_coordinates_are_distinct_from_exif(self):
        xmp = (b'<x:xmpmeta xmlns:x="adobe:ns:meta/" '
            b'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
            b'xmlns:tiff="http://ns.adobe.com/tiff/1.0/" '
            b'xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/">'
            b'<rdf:RDF><rdf:Description tiff:Make="DJI" '
            b'drone-dji:GpsStatus="Normal" drone-dji:GpsLatitude="16.9" '
            b'drone-dji:GpsLongitude="121.7"/></rdf:RDF></x:xmpmeta>')
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "drone.jpg"
            base = io.BytesIO()
            Image.new("RGB", (40, 30), "green").save(base, format="JPEG")
            marker = b"http://ns.adobe.com/xap/1.0/\x00" + xmp
            segment = b"\xff\xe1" + struct.pack(">H", len(marker) + 2) + marker
            path.write_bytes(base.getvalue()[:2] + segment + base.getvalue()[2:])
            _, meta = inspect_image(path)
            self.assertEqual(meta["location"], {"source": "dji_xmp", "lat": 16.9, "lng": 121.7})
            self.assertIn("dji_xmp_gps_used", meta["quality_flags"])


if __name__ == "__main__":
    unittest.main()
