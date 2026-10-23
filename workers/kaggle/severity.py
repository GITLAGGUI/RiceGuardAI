"""Per-photo pixel measurements for automated severity (method exg_otsu_hsv_v1).

Severity for disease d on photo i is 100 * lesion_pixels[d] / plant_pixels, i.e. the
percent of visible rice tissue that is diseased: the quantity the IRRI SES scales grade.
This module only measures; grading and picking the representative photo happen server-side.
"""

from __future__ import annotations

import cv2
import numpy as np

METHOD = "exg_otsu_hsv_v1"
MIN_COMPONENT_PIXELS = 25
EXG_THRESHOLD_RANGE = (0.02, 0.20)


def plant_tissue_mask(rgb: np.ndarray) -> np.ndarray:
    """Green vegetation (Excess Green, Otsu) plus yellow/brown leaf tissue (HSV)."""
    pixels = rgb.astype(np.float32)
    total = pixels.sum(axis=2) + 1e-6
    r, g, b = (pixels[..., channel] / total for channel in range(3))
    exg = 2 * g - r - b
    # Otsu on an 8-bit rescale of ExG in [-1, 2], clamped so a mostly-green or
    # mostly-soil frame cannot push the cut to an extreme.
    scaled = np.clip((exg + 1) / 3 * 255, 0, 255).astype(np.uint8)
    otsu, _ = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    cut = float(np.clip(otsu / 255 * 3 - 1, *EXG_THRESHOLD_RANGE))
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    hue = hsv[..., 0].astype(np.float32) * 2  # OpenCV hue is 0-179
    saturation = hsv[..., 1].astype(np.float32) / 255
    value = hsv[..., 2].astype(np.float32) / 255
    lit = (value >= 0.12) & ~((value > 0.92) & (saturation < 0.12))  # drop shadow and glare/sky
    green = (exg >= cut) & lit
    # Yellowing or straw-coloured leaves are bright; dark brown soil and mud are not.
    senescent = (hue >= 25) & (hue <= 60) & (saturation >= 0.35) & (value >= 0.45)
    return green | senescent


def remove_specks(mask: np.ndarray, minimum: int = MIN_COMPONENT_PIXELS) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if count <= 1:
        return mask.astype(bool)
    keep = np.zeros(count, dtype=bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= minimum
    return keep[labels]


def measure(rgb: np.ndarray, masks: dict[str, np.ndarray]) -> dict:
    """Return integer pixel counts only; no grade, no claims."""
    lesions = {disease: remove_specks(mask) for disease, mask in masks.items()}
    plant = plant_tissue_mask(rgb)
    for lesion in lesions.values():
        plant |= lesion  # diseased tissue is plant tissue even when it is no longer green
    plant_pixels = int(plant.sum())
    return {"method": METHOD, "frame_pixels": int(rgb.shape[0] * rgb.shape[1]),
            "plant_pixels": plant_pixels,
            "lesion_pixels": {disease: int(mask.sum()) for disease, mask in lesions.items()}}
