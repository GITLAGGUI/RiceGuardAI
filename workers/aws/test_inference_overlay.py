"""Display overlays: tint and outline only (the website draws the legend), plus web layers."""
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

from workers.aws import inference_core as core


def fixture():
    image = Image.new("RGB", (120, 80), (40, 120, 40))
    blb = np.zeros((80, 120), dtype=bool)
    blb[10:30, 10:50] = True
    spot = np.zeros((80, 120), dtype=bool)
    spot[50:70, 70:110] = True
    return image, {"BLB": blb, "Brown Spot": spot}


def test_overlay_burns_no_text_or_boxes():
    image, masks = fixture()
    with patch.object(cv2, "putText", wraps=cv2.putText) as text, patch.object(cv2, "rectangle", wraps=cv2.rectangle) as box:
        result = core.overlay(image, masks, show_boxes=True)
    assert text.call_count == 0 and box.call_count == 0
    assert result.size == image.size


def test_blb_is_yellow_and_brown_spot_is_red():
    image, masks = fixture()
    pixels = np.asarray(core.overlay(image, masks, alpha=1.0, show_outlines=False))
    assert tuple(pixels[20, 30]) == core.COLORS["BLB"] == (255, 212, 0)
    assert tuple(pixels[60, 90]) == core.COLORS["Brown Spot"] == (0, 230, 118)
    assert tuple(pixels[5, 100]) == (40, 120, 40)


def test_disease_layer_is_transparent_outside_the_mask_and_web_sized():
    mask = np.zeros((3000, 4000), dtype=bool)
    mask[1000:1010, 100:3900] = True  # a thin streak must survive downscaling
    layer = core.disease_layer(mask, "BLB")
    assert layer.mode == "RGBA" and max(layer.size) == 2048
    alpha = np.asarray(layer)[..., 3]
    assert alpha[0, 0] == 0 and alpha.max() > 0
