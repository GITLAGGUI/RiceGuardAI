"""Load and run the two pinned disease specialists behind one tile interface.

BLB: b10 UNet ConvNeXt-B (DINOv3) lesion model, smp 0.5.0 / timm 1.0.30, fp16 EMA weights.
Brown Spot: YOLO26l semantic model (ultralytics 8.4.115), foreground class 1.
Both return boolean lesion masks at native tile size; stitching is shared.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from .prepare_clip import digest

TILE = 1024
STRIDE = 768
BATCH = 4
# File name, artifact SHA-256, loader kind, expected class name (YOLO only).
PINNED = {
    "BLB": ("blb.pt", "7006f33bf08cdfe291a2e3907b28e9e71107289ad6ea81299c9c9b17e98bdf17", "smp", None),
    "Brown Spot": ("brownspot.pt", "b311478a6c47e353c353b9ec060a3e885ad431394d7dade04b6972fd59060b33", "yolo", "Brown Spot"),
}
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32) * 255
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32) * 255


def axis_starts(length: int) -> list[int]:
    if length <= TILE:
        return [0]
    starts = list(range(0, length - TILE + 1, STRIDE))
    if starts[-1] != length - TILE:
        starts.append(length - TILE)
    return starts


class SmpSpecialist:
    """Sigmoid lesion probability >= 0.5, the threshold the b10 cross-validation used."""

    def __init__(self, path: Path, device: str):
        import segmentation_models_pytorch as smp
        import torch

        checkpoint = torch.load(path, map_location="cpu", weights_only=False)
        config = checkpoint["config"]
        if config.get("arch") != "Unet" or config.get("encoder") != "tu-convnext_base.dinov3_lvd1689m":
            raise ValueError("BLB checkpoint is not the pinned b10 UNet ConvNeXt-B")
        net = smp.create_model(config["arch"], encoder_name=config["encoder"], encoder_weights=None,
                               in_channels=3, classes=1)
        net.load_state_dict({key: value.float() for key, value in checkpoint["state_dict"].items()})
        self.torch = torch
        self.device = device
        self.net = net.to(device).eval().to(memory_format=torch.channels_last)

    def predict(self, tiles: list[Image.Image]) -> list[np.ndarray]:
        torch = self.torch
        arrays = [np.asarray(tile.convert("RGB"), dtype=np.float32) for tile in tiles]
        height = max(a.shape[0] for a in arrays)
        width = max(a.shape[1] for a in arrays)
        # UNet needs sides divisible by 32; reflect-pad small edge tiles, then crop back.
        padded_h, padded_w = -(-height // 32) * 32, -(-width // 32) * 32
        batch = np.stack([np.pad(a, ((0, padded_h - a.shape[0]), (0, padded_w - a.shape[1]), (0, 0)), mode="reflect")
                          for a in arrays])
        batch = (batch - IMAGENET_MEAN) / IMAGENET_STD
        x = torch.from_numpy(batch).permute(0, 3, 1, 2).contiguous().to(self.device)
        x = x.contiguous(memory_format=torch.channels_last)
        with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16, enabled=self.device != "cpu"):
            probability = torch.sigmoid(self.net(x).float())[:, 0].cpu().numpy()
        return [probability[i, :a.shape[0], :a.shape[1]] >= 0.5 for i, a in enumerate(arrays)]


class YoloSpecialist:
    def __init__(self, path: Path, device: str, class_name: str):
        from ultralytics import YOLO

        model = YOLO(str(path))
        if model.task != "semantic" or model.names.get(1) != class_name:
            raise ValueError(f"Semantic class mapping mismatch: {class_name}")
        self.model = model
        self.device = 0 if device != "cpu" else "cpu"

    def predict(self, tiles: list[Image.Image]) -> list[np.ndarray]:
        results = self.model.predict(tiles, imgsz=TILE, device=self.device, half=self.device != "cpu",
                                     batch=len(tiles), verbose=False)
        if len(results) != len(tiles):
            raise RuntimeError("A specialist skipped an inference tile")
        masks = []
        for tile, result in zip(tiles, results):
            if result.semantic_mask is None:
                raise RuntimeError("Missing semantic prediction")
            labels = np.asarray(result.semantic_mask.data.detach().cpu().numpy())
            if labels.ndim != 2 or not np.isin(labels, (0, 1)).all():
                raise RuntimeError("Invalid foreground class map")
            if labels.shape != (tile.height, tile.width):
                labels = cv2.resize(labels.astype(np.uint8), (tile.width, tile.height),
                                    interpolation=cv2.INTER_NEAREST)
            masks.append(labels == 1)
        return masks


def load_specialists(input_dir: Path, require_gpu: bool = True):
    import torch

    if require_gpu and not torch.cuda.is_available():
        raise RuntimeError("A Kaggle GPU is required; CPU fallback is disabled")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    models = {}
    for disease, (filename, expected_hash, kind, class_name) in PINNED.items():
        path = input_dir / filename
        if digest(path) != expected_hash:
            raise ValueError(f"Pinned checkpoint hash mismatch: {disease}")
        models[disease] = SmpSpecialist(path, device) if kind == "smp" else YoloSpecialist(path, device, class_name)
    import segmentation_models_pytorch
    import timm
    import ultralytics

    runtime = {"gpu": torch.cuda.get_device_name(0) if device == "cuda" else "cpu", "torch": torch.__version__,
               "ultralytics": ultralytics.__version__, "smp": segmentation_models_pytorch.__version__,
               "timm": timm.__version__, "model_hashes": {d: spec[1] for d, spec in PINNED.items()}}
    return models, runtime


def stitch(image: Image.Image, specialist) -> np.ndarray:
    """Overlapping 1024 px tiles, majority vote where tiles overlap."""
    width, height = image.size
    boxes = [(x, y, min(x + TILE, width), min(y + TILE, height))
             for y in axis_starts(height) for x in axis_starts(width)]
    votes = np.zeros((height, width), dtype=np.uint8)
    coverage = np.zeros_like(votes)
    for start in range(0, len(boxes), BATCH):
        chunk = boxes[start:start + BATCH]
        masks = specialist.predict([image.crop(box) for box in chunk])
        for (x1, y1, x2, y2), mask in zip(chunk, masks):
            if mask.shape != (y2 - y1, x2 - x1):
                raise RuntimeError("Checkpoint tile dimensions mismatch")
            votes[y1:y2, x1:x2] += mask.astype(np.uint8)
            coverage[y1:y2, x1:x2] += 1
    if not np.all(coverage):
        raise RuntimeError("Tiled inference left uncovered pixels")
    return votes * 2 >= coverage
