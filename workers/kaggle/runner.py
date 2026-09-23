"""Private Kaggle batch worker for RiceGuardAI.

The Vercel dispatcher prepends the run-scoped constants. This worker downloads
only the authorized Drive files and pinned model artifacts, runs independent
semantic specialists, and returns a replay-safe result manifest.
"""

import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

subprocess.check_call([
    sys.executable,
    "-m",
    "pip",
    "install",
    "-q",
    "segmentation-models-pytorch==0.5.0",
    "opencv-python-headless==4.12.0.88",
    "av==15.1.0",
    "requests==2.32.5",
    "Pillow==11.3.0",
])

import av
import cv2
import numpy as np
import requests
import torch
import segmentation_models_pytorch as smp
from PIL import Image, ImageOps

JOB_ID = globals().get("JOB_ID", os.environ.get("RICEGUARD_JOB_ID", ""))
RUN_ID = globals().get("RUN_ID", os.environ.get("RICEGUARD_RUN_ID", ""))
WORKER_TOKEN = globals().get("WORKER_TOKEN", os.environ.get("RICEGUARD_WORKER_TOKEN", ""))
CALLBACK_URL = globals().get("CALLBACK_URL", os.environ.get("RICEGUARD_CALLBACK_URL", ""))
HEADERS = {"Authorization": f"Bearer {WORKER_TOKEN}", "Content-Type": "application/json"}
SEQUENCE = 0


def callback(action, payload=None):
    global SEQUENCE
    body = {"job_id": JOB_ID, "action": action}
    if action != "manifest":
        SEQUENCE += 1
        body["sequence"] = SEQUENCE
        body["payload"] = payload or {}
    response = requests.post(CALLBACK_URL, headers=HEADERS, json=body, timeout=120)
    response.raise_for_status()
    return response.json()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def drive_download(file_id, destination, token):
    with requests.get(
        f"https://www.googleapis.com/drive/v3/files/{file_id}",
        params={"alt": "media", "supportsAllDrives": "true"},
        headers={"Authorization": f"Bearer {token}"},
        stream=True,
        timeout=600,
    ) as response:
        response.raise_for_status()
        with open(destination, "wb") as output:
            for chunk in response.iter_content(8 * 1024 * 1024):
                output.write(chunk)


def drive_folder(name, parent, token):
    response = requests.post(
        "https://www.googleapis.com/drive/v3/files",
        params={"supportsAllDrives": "true", "fields": "id"},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [parent]},
        timeout=120,
    )
    response.raise_for_status()
    return response.json()["id"]


def drive_upload(path, parent, token, mime):
    metadata = json.dumps({"name": Path(path).name, "parents": [parent]})
    with open(path, "rb") as stream:
        response = requests.post(
            "https://www.googleapis.com/upload/drive/v3/files",
            params={"uploadType": "multipart", "supportsAllDrives": "true", "fields": "id,md5Checksum,size"},
            headers={"Authorization": f"Bearer {token}"},
            files={
                "metadata": (None, metadata, "application/json; charset=UTF-8"),
                "file": (Path(path).name, stream, mime),
            },
            timeout=900,
        )
    response.raise_for_status()
    return response.json()


def upload_signed(path, upload, mime, supabase_base, bucket):
    url = f"{supabase_base}/storage/v1/object/upload/sign/{bucket}/{upload['path']}"
    with open(path, "rb") as stream:
        response = requests.put(url, params={"token": upload["token"]}, headers={"Content-Type": mime}, data=stream, timeout=600)
    response.raise_for_status()
    return upload["path"]


def review_image_files(image, masks, asset_id, uploads, work, supabase_base):
    paths = {}
    variants = {
        "original": image,
        "BLB": overlay(image, {"BLB": masks["BLB"]}),
        "Brown Spot": overlay(image, {"Brown Spot": masks["Brown Spot"]}),
        "combined": overlay(image, masks),
    }
    for name, array in variants.items():
        output = work / f"{asset_id}-review-{name.lower().replace(' ', '-')}.webp"
        picture = Image.fromarray(array)
        picture.thumbnail((2048, 2048))
        picture.save(output, "WEBP", quality=84, method=5)
        paths[name] = upload_signed(output, uploads[name], "image/webp", supabase_base, "rg-review-previews")
    return paths


class Specialist:
    def __init__(self, config, weights_path):
        self.disease = config["disease"]
        self.size = int(config["input_size"])
        self.overlap = float(config["overlap"])
        self.threshold = float(config["threshold"])
        self.minimum_component = int(config.get("minimum_component_pixels") or 0)
        prep = config.get("preprocessing") or {}
        self.mean = np.asarray(prep.get("mean", [0.485, 0.456, 0.406]), dtype=np.float32)
        self.std = np.asarray(prep.get("std", [0.229, 0.224, 0.225]), dtype=np.float32)
        architecture = str(config["architecture"]).lower().replace("+", "plus").replace("_", "")
        classes = {
            "unetplusplus": smp.UnetPlusPlus,
            "deeplabv3plus": smp.DeepLabV3Plus,
            "manet": smp.MAnet,
        }
        if architecture not in classes:
            raise ValueError(f"Unsupported architecture: {config['architecture']}")
        self.model = classes[architecture](encoder_name=config["encoder"], encoder_weights=None, in_channels=3, classes=1)
        checkpoint = torch.load(weights_path, map_location="cpu", weights_only=False)
        state = checkpoint.get("state_dict", checkpoint.get("model", checkpoint)) if isinstance(checkpoint, dict) else checkpoint
        state = {str(key).removeprefix("module."): value for key, value in state.items()}
        missing, unexpected = self.model.load_state_dict(state, strict=False)
        if len(missing) > 8 or len(unexpected) > 8:
            raise ValueError(f"Checkpoint mismatch for {self.disease}: {len(missing)} missing, {len(unexpected)} unexpected")
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model.to(self.device).eval()

    def _batch(self, tiles):
        array = np.stack(tiles).astype(np.float32) / 255.0
        array = (array - self.mean) / self.std
        tensor = torch.from_numpy(array.transpose(0, 3, 1, 2)).to(self.device)
        with torch.inference_mode(), torch.autocast(device_type=self.device.type, enabled=self.device.type == "cuda"):
            output = self.model(tensor)
            if isinstance(output, (tuple, list)):
                output = output[0]
            if isinstance(output, dict):
                output = output.get("out", next(iter(output.values())))
            return torch.sigmoid(output).float().cpu().numpy()[:, 0]

    def predict(self, image):
        height, width = image.shape[:2]
        size = self.size
        stride = max(64, int(size * (1.0 - self.overlap)))
        padded_h = max(size, int(np.ceil(max(0, height - size) / stride)) * stride + size)
        padded_w = max(size, int(np.ceil(max(0, width - size) / stride)) * stride + size)
        padded = cv2.copyMakeBorder(image, 0, padded_h - height, 0, padded_w - width, cv2.BORDER_REFLECT_101)
        axis = np.hanning(size).astype(np.float32)
        weight = np.maximum(np.outer(axis, axis), 0.05)
        scores = np.zeros((padded_h, padded_w), dtype=np.float32)
        weights = np.zeros_like(scores)
        positions = [(y, x) for y in range(0, padded_h - size + 1, stride) for x in range(0, padded_w - size + 1, stride)]
        batch_size = 4
        for start in range(0, len(positions), batch_size):
            batch_positions = positions[start:start + batch_size]
            tiles = [padded[y:y + size, x:x + size] for y, x in batch_positions]
            for (y, x), probability in zip(batch_positions, self._batch(tiles)):
                scores[y:y + size, x:x + size] += probability * weight
                weights[y:y + size, x:x + size] += weight
        probability = (scores / np.maximum(weights, 1e-6))[:height, :width]
        mask = (probability >= self.threshold).astype(np.uint8)
        if self.minimum_component > 0:
            count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
            keep = np.zeros_like(mask)
            for label in range(1, count):
                if stats[label, cv2.CC_STAT_AREA] >= self.minimum_component:
                    keep[labels == label] = 1
            mask = keep
        return mask, probability, len(positions)


def overlay(image, masks):
    result = image.astype(np.float32).copy()
    colors = {"BLB": np.array([239, 196, 62]), "Brown Spot": np.array([171, 72, 54])}
    for disease, mask in masks.items():
        region = mask.astype(bool)
        result[region] = result[region] * 0.48 + colors[disease] * 0.52
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(result, contours, -1, tuple(int(x) for x in colors[disease]), 2)
    return np.clip(result, 0, 255).astype(np.uint8)


def image_array(path):
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        return np.asarray(image)


def save_mask(mask, path):
    Image.fromarray(mask * 255, mode="L").save(path, optimize=True)


def process_image(path, asset, specialists, result_folder, drive_token, work, review_uploads, supabase_base):
    image = image_array(path)
    masks = {}
    classes = {}
    total_tiles = 0
    for disease, specialist in specialists.items():
        mask, _, tiles = specialist.predict(image)
        total_tiles += tiles
        masks[disease] = mask
        mask_path = work / f"{asset['id']}-{disease.lower().replace(' ', '-')}.png"
        save_mask(mask, mask_path)
        uploaded = drive_upload(mask_path, result_folder, drive_token, "image/png")
        pixels = int(mask.sum())
        classes[disease] = {
            "mask_drive_file_id": uploaded["id"],
            "predicted_pixels": pixels,
            "mask_fraction_of_image": pixels / float(mask.size),
            "threshold": specialist.threshold,
        }
    ambiguous = int(np.logical_and(masks["BLB"], masks["Brown Spot"]).sum())
    return {
        "source_asset_id": asset["id"],
        "kind": "image",
        "width": int(image.shape[1]),
        "height": int(image.shape[0]),
        "classes": classes,
        "ambiguous_overlap_pixels": ambiguous,
        "tile_count": total_tiles,
        "review_paths": review_image_files(image, masks, asset["id"], review_uploads, work, supabase_base),
    }, image, masks


def process_video(path, asset, specialists, result_folder, drive_token, work, review_upload, supabase_base):
    source = av.open(str(path))
    input_stream = source.streams.video[0]
    output_path = work / f"{asset['id']}-review.mp4"
    output = av.open(str(output_path), mode="w")
    rate = input_stream.average_rate or 30
    output_stream = output.add_stream("libx264", rate=rate)
    output_stream.width = input_stream.codec_context.width
    output_stream.height = input_stream.codec_context.height
    output_stream.pix_fmt = "yuv420p"
    frames = []
    frame_index = 0
    for frame in source.decode(input_stream):
        rgb = frame.to_ndarray(format="rgb24")
        masks = {}
        counts = {}
        for disease, specialist in specialists.items():
            mask, _, _ = specialist.predict(rgb)
            masks[disease] = mask
            counts[disease] = int(mask.sum())
        rendered = av.VideoFrame.from_ndarray(overlay(rgb, masks), format="rgb24")
        rendered.pts = frame.pts
        rendered.time_base = frame.time_base
        for packet in output_stream.encode(rendered):
            output.mux(packet)
        frames.append({
            "index": frame_index,
            "timestamp_seconds": float(frame.time or 0),
            "predicted_pixels": counts,
            "ambiguous_overlap_pixels": int(np.logical_and(masks["BLB"], masks["Brown Spot"]).sum()),
        })
        frame_index += 1
        if frame_index % 20 == 0:
            callback("progress", {"progress": min(95, 20 + frame_index // 2), "asset": asset["id"], "frames": frame_index})
    for packet in output_stream.encode():
        output.mux(packet)
    output.close()
    source.close()
    uploaded = drive_upload(output_path, result_folder, drive_token, "video/mp4")
    review_path = upload_signed(output_path, review_upload, "video/mp4", supabase_base, "rg-review-previews")
    return {
        "source_asset_id": asset["id"],
        "kind": "video",
        "width": int(input_stream.codec_context.width),
        "height": int(input_stream.codec_context.height),
        "classes": {"BLB": {"video_frame_measurements": True}, "Brown Spot": {"video_frame_measurements": True}},
        "annotated_video_drive_file_id": uploaded["id"],
        "review_paths": {"video": review_path},
        "frame_measurements": frames,
        "field_area_aggregation_allowed": False,
    }, output_path


def main():
    if not all((JOB_ID, RUN_ID, WORKER_TOKEN, CALLBACK_URL)):
        raise RuntimeError("Run-scoped worker credentials are missing")
    context = callback("manifest")
    drive_token = context["drive"]["access_token"]
    parent = context["drive"]["app_folder_id"]
    supabase_base = CALLBACK_URL.split("/functions/v1/")[0]
    work = Path(tempfile.mkdtemp(prefix="riceguard-worker-"))
    callback("progress", {"progress": 2, "stage": "downloading-models"})
    specialists = {}
    for config in context["models"]:
        checkpoint = work / f"{config['disease'].lower().replace(' ', '-')}.pt"
        drive_download(config["artifact_drive_file_id"], checkpoint, drive_token)
        if sha256_file(checkpoint) != config["artifact_sha256"]:
            raise RuntimeError(f"Checkpoint checksum failed for {config['disease']}")
        specialists[config["disease"]] = Specialist(config, checkpoint)
    result_folder = drive_folder(RUN_ID, parent, drive_token)
    results = []
    first_image = None
    first_masks = None
    video_preview = None
    assets = context["manifest"]["assets"]
    for index, asset in enumerate(assets):
        local = work / asset["filename"]
        drive_download(asset["drive_file_id"], local, drive_token)
        if sha256_file(local) != asset["checksum"]:
            raise RuntimeError(f"Original SHA-256 verification failed: {asset['filename']}")
        mime = asset.get("mime") or ""
        if mime.startswith("image/"):
            result, image, masks = process_image(local, asset, specialists, result_folder, drive_token, work, context["review_uploads"][asset["id"]], supabase_base)
            results.append(result)
            if first_image is None:
                first_image, first_masks = image, masks
        elif mime == "video/mp4":
            result, video_preview = process_video(local, asset, specialists, result_folder, drive_token, work, context["review_uploads"][asset["id"]]["video"], supabase_base)
            results.append(result)
        else:
            results.append({"source_asset_id": asset["id"], "kind": "telemetry_sidecar", "width": 1, "height": 1, "classes": {"BLB": {}, "Brown Spot": {}}, "used_for_location": False})
        callback("progress", {"progress": min(95, 10 + round((index + 1) / len(assets) * 80)), "stage": "inference", "asset": asset["id"]})

    preview_paths = {}
    if first_image is not None:
        for disease in ("BLB", "Brown Spot"):
            preview_path = work / f"preview-{disease.lower().replace(' ', '-')}.webp"
            Image.fromarray(overlay(first_image, {disease: first_masks[disease]})).save(preview_path, "WEBP", quality=82, method=5)
            preview_paths[disease] = upload_signed(preview_path, context["preview_uploads"][disease], "image/webp", supabase_base, "rg-public-previews")
        combined_path = work / "preview-combined.webp"
        Image.fromarray(overlay(first_image, first_masks)).save(combined_path, "WEBP", quality=82, method=5)
        preview_paths["combined"] = upload_signed(combined_path, context["preview_uploads"]["combined"], "image/webp", supabase_base, "rg-public-previews")
    if video_preview:
        preview_paths["video"] = upload_signed(video_preview, context["preview_uploads"]["video"], "video/mp4", supabase_base, "rg-public-previews")

    image_results = [item for item in results if item["kind"] == "image"]
    numerator = {
        disease: sum(int(item["classes"][disease]["predicted_pixels"]) for item in image_results)
        for disease in ("BLB", "Brown Spot")
    }
    manifest = {
        "schema_version": "riceguard.result.v1",
        "run_id": RUN_ID,
        "source_manifest_hash": context["source_manifest_hash"],
        "drive_folder_id": result_folder,
        "model_versions": {config["disease"]: config["version"] for config in context["models"]},
        "assets": results,
        "measurements": {
            "blb_disease_region_coverage": None,
            "brown_spot_affected_leaf_coverage": None,
            "visible_rice_leaf_denominator_reviewed": False,
            "predicted_pixels": numerator,
        },
        "assessment": {"status": "not_calibrated", "label": "not_calibrated", "calibration_version": None},
        "preview_paths": preview_paths,
        "warnings": [
            "Visible rice-leaf denominator requires staff review before coverage is reported.",
            "Brown Spot whole-leaf masks are not lesion-area severity.",
            "Video frame pixels are not summed into field-area estimates.",
        ],
        "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    callback("complete", {"result_manifest": manifest})
    print(json.dumps({"status": "complete", "job_id": JOB_ID, "assets": len(results)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        try:
            callback("failed", {"error": str(error)[:1000]})
        finally:
            raise
