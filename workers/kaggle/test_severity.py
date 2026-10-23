import numpy as np

from workers.kaggle import severity


def test_plant_mask_keeps_leaves_and_drops_water_and_soil():
    rgb = np.zeros((40, 60, 3), dtype=np.uint8)
    rgb[:, :20] = (60, 150, 50)    # green leaves
    rgb[:, 20:40] = (120, 125, 130)  # grey water
    rgb[:, 40:] = (90, 70, 55)     # dark soil
    plant = severity.plant_tissue_mask(rgb)
    assert plant[:, :20].mean() > 0.95
    assert plant[:, 20:].mean() < 0.05


def test_measure_counts_lesions_as_plant_and_drops_specks():
    rgb = np.full((50, 50, 3), (60, 150, 50), dtype=np.uint8)
    rgb[:10, :] = (120, 125, 130)
    lesion = np.zeros((50, 50), dtype=bool)
    lesion[:10, :10] = True       # 100 px lesion on a grey (non-green) area
    lesion[40, 40] = True         # 1 px speck
    result = severity.measure(rgb, {"BLB": lesion, "Brown Spot": np.zeros_like(lesion)})
    assert result["lesion_pixels"] == {"BLB": 100, "Brown Spot": 0}
    assert result["plant_pixels"] == 40 * 50 + 100
    assert result["frame_pixels"] == 2500 and result["method"] == "exg_otsu_hsv_v1"
