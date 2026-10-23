"""Display-only overlay tests: no weights, GPU, network or publication."""
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image
import pytest

from workers.aws import inference_core as core
from workers.kaggle.pinned_video_core import render


def fixture():
    image = Image.new('RGB', (640, 480), (40, 100, 45))
    blb = np.zeros((480, 640), dtype=bool)
    brown = np.zeros_like(blb)
    blb[100:220, 70:200] = True
    brown[270:370, 360:490] = True
    return image, {'BLB': blb, 'Brown Spot': brown}


def test_default_is_one_legend_without_region_boxes_or_repeated_labels():
    image, masks = fixture()
    with patch.object(cv2, 'putText', wraps=cv2.putText) as draw:
        core.overlay(image, masks)
    labels = [call.args[1] for call in draw.call_args_list]
    assert labels == ['BLB', 'Brown Spot']
    assert not any('region' in text or 'Boxes:' in text for text in labels)


def test_requested_rgb_colors_are_exact_and_independent_of_input_order():
    image, masks = fixture()
    first = np.asarray(core.overlay(image, masks, alpha=1, show_outlines=False, show_legend=False))
    second = np.asarray(core.overlay(image, dict(reversed(list(masks.items()))), alpha=1,
                                     show_outlines=False, show_legend=False))
    np.testing.assert_array_equal(first, second)
    assert tuple(first[150, 100]) == (255, 214, 10)
    assert tuple(first[300, 400]) == (239, 68, 68)


def test_overlapping_predictions_keep_both_colors_without_a_third_disease_color():
    image, masks = fixture()
    masks['Brown Spot'] |= masks['BLB']
    result = np.asarray(core.overlay(image, masks, alpha=1, show_outlines=False, show_legend=False))
    colors = {tuple(pixel) for pixel in result[110:200, 90:180].reshape(-1, 3)}
    assert colors == {(255, 214, 10), (239, 68, 68)}


def test_drawing_preserves_masks_original_pixels_and_dimensions():
    image, masks = fixture()
    source = np.asarray(image).copy()
    before = {name: mask.copy() for name, mask in masks.items()}
    result = core.overlay(image, masks)
    assert result.size == image.size
    np.testing.assert_array_equal(np.asarray(image), source)
    for name in masks:
        np.testing.assert_array_equal(masks[name], before[name])


def test_no_detections_has_no_legend_and_leaves_image_unchanged():
    image, masks = fixture()
    with patch.object(cv2, 'putText', wraps=cv2.putText) as draw:
        result = core.overlay(image, {name: np.zeros_like(mask) for name, mask in masks.items()})
    draw.assert_not_called()
    np.testing.assert_array_equal(np.asarray(result), np.asarray(image))


def test_video_uses_the_same_uncluttered_default():
    image, masks = fixture()
    np.testing.assert_array_equal(render(image, masks), np.asarray(core.overlay(image, masks)))


@pytest.mark.parametrize('mask', [np.zeros((2, 2)), np.full((480, 640), np.nan), np.full((480, 640), 2)])
def test_bad_masks_still_fail_closed(mask):
    with pytest.raises(ValueError):
        core.overlay(Image.new('RGB', (640, 480)), {'BLB': mask})


@pytest.mark.parametrize('size', [(16, 12), (80, 60), (320, 240)])
def test_small_images_never_gain_a_larger_canvas_or_crash(size):
    image = Image.new('RGB', size, 'green')
    result = core.overlay(image, {'BLB': np.ones((size[1], size[0]), dtype=bool)})
    assert result.size == size
