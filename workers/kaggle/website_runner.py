"""Private Kaggle entrypoint for one bounded RiceGuardAI media job."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

subprocess.check_call([sys.executable, "-m", "pip", "install", "-q",
                       "ultralytics==8.4.115", "segmentation-models-pytorch==0.5.0", "timm==1.0.30",
                       "requests==2.32.5", "Pillow==11.3.0"])

import requests

from workers.kaggle.pinned_photo_core import run_photos
from workers.kaggle.pinned_video_core import run as run_video
from workers.kaggle.specialists import load_specialists
from workers.kaggle.prepare_clip import digest, prepare
from workers.kaggle.private_upload import upload_private
from workers.kaggle.website_adapter import build_result_v2, local_code_hashes


JOB_ID = os.environ.get("RICEGUARD_JOB_ID", "")
RUN_ID = os.environ.get("RICEGUARD_RUN_ID", "")
WORKER_TOKEN = os.environ.get("RICEGUARD_WORKER_TOKEN", "")
CALLBACK_URL = os.environ.get("RICEGUARD_CALLBACK_URL", "")
HEADERS = {"Authorization": f"Bearer {WORKER_TOKEN}", "Content-Type": "application/json"}
SEQUENCE = 0
NATIVE_COMPLETED = False


def callback(action: str, payload: dict | None = None, sequenced: bool = False) -> dict:
    """POST one worker event. Transient failures are retried with the same body and
    sequence, which the callback treats as an idempotent replay."""
    global SEQUENCE
    body = {"job_id": JOB_ID, "action": action}
    if sequenced:
        SEQUENCE += 1
        body["sequence"] = SEQUENCE
    if payload is not None:
        body["payload"] = payload
    attempts = 5
    response = None
    for attempt in range(attempts):
        try:
            response = requests.post(CALLBACK_URL, headers=HEADERS, json=body, timeout=180)
        except requests.RequestException:
            response = None
            if attempt + 1 >= attempts:
                raise RuntimeError(f"Worker callback {action} was unreachable")
            time.sleep(2 ** (attempt + 1))
            continue
        if response.ok:
            return response.json()
        if response.status_code not in (429, 500, 502, 503, 504) or attempt + 1 >= attempts:
            break
        time.sleep(2 ** (attempt + 1))
    try:
        reason = str(response.json().get("error", "callback unavailable"))[:240]
    except Exception:
        reason = "callback unavailable"
    raise RuntimeError(f"Worker callback {action} returned {response.status_code}: {reason}")


def download(url: str, destination: Path, expected_sha256: str | None = None):
    if not isinstance(url, str) or not url.startswith("https://"):
        raise ValueError("A private HTTPS download URL is required")
    with requests.get(url, stream=True, timeout=(20, 900)) as response:
        response.raise_for_status()
        with destination.open("wb") as output:
            for chunk in response.iter_content(8 * 1024 * 1024):
                if chunk:
                    output.write(chunk)
    if expected_sha256 and digest(destination) != expected_sha256:
        raise RuntimeError("Downloaded private artifact checksum mismatch")


def drive_download(file_id: str, destination: Path, token: str, expected_sha256: str):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{10,200}", file_id or ""):
        raise ValueError("Invalid verified Drive file identifier")
    url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&supportsAllDrives=true"
    with requests.get(url, headers={"Authorization": f"Bearer {token}"}, stream=True,
                      timeout=(20, 900)) as response:
        response.raise_for_status()
        with destination.open("wb") as output:
            for chunk in response.iter_content(8 * 1024 * 1024):
                if chunk:
                    output.write(chunk)
    if digest(destination) != expected_sha256:
        raise RuntimeError("Verified Drive original checksum mismatch")


def main():
    global NATIVE_COMPLETED
    if (not re.fullmatch(r"[0-9a-f-]{36}", JOB_ID, re.I) or
            not re.fullmatch(r"rg-[a-z0-9-]{8,80}", RUN_ID) or len(WORKER_TOKEN) < 32 or
            not CALLBACK_URL.startswith("https://")):
        raise RuntimeError("Run-scoped worker credentials are invalid")
    context = callback("manifest-pinned")
    manifest = context["source_manifest"]
    if context["run_id"] != RUN_ID:
        raise RuntimeError("Pinned run identifier mismatch")
    if manifest.get("manifest_hash") is not None and manifest["manifest_hash"] != context["source_manifest_hash"]:
        raise RuntimeError("Pinned source manifest mismatch")
    root = Path(tempfile.mkdtemp(prefix="riceguard-pinned-"))
    inputs, photo_results, video_results = root / "inputs", root / "photos", root / "video"
    inputs.mkdir()
    callback("progress", {"progress": 2, "stage": "downloading-pinned-inputs"}, True)
    # Models and Drive originals download in parallel; each is still checksum-verified.
    sources = []
    local_by_id = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        pending = []
        for disease, filename in (("BLB", "blb.pt"), ("Brown Spot", "brownspot.pt")):
            model = context["bundle"]["models"][disease]
            pending.append(pool.submit(download, context["model_downloads"][disease], inputs / filename,
                                       model["sha256"]))
        for asset in manifest["assets"]:
            local = inputs / f"{asset['id']}{Path(asset['filename']).suffix.lower()}"
            pending.append(pool.submit(drive_download, asset["drive_file_id"], local,
                                       context["drive_access_token"], asset["checksum"]))
            local_by_id[asset["id"]] = local
            sources.append({"id": asset["id"], "mime": asset["mime"], "width": asset["width"],
                            "height": asset["height"], "sha256": asset["checksum"],
                            "clip_start_seconds": asset.get("clip_start_seconds"),
                            "clip_duration_seconds": asset.get("clip_duration_seconds"),
                            "linked_photo_asset_id": asset.get("linked_photo_asset_id")})
        for future in pending:
            future.result()
    models, runtime = load_specialists(inputs)
    callback("progress", {"progress": 7, "stage": "models-verified", "runtime": runtime}, True)

    photos = [item for item in sources if item["mime"] in ("image/jpeg", "image/png")]
    photo_receipts = run_photos([{**item, "path": str(local_by_id[item["id"]])} for item in photos],
                                models, photo_results)
    callback("progress", {"progress": 35, "stage": "photos-complete"}, True)
    video = next((item for item in sources if item["mime"] == "video/mp4"), None)
    video_summary = video_receipts = video_input_manifest = None
    video_root = None
    if video:
        video_input = root / "video-input"
        video_input_manifest = prepare(local_by_id[video["id"]], video_input,
                                       video["clip_start_seconds"], video["clip_duration_seconds"],
                                       video["linked_photo_asset_id"])
        for filename in ("blb.pt", "brownspot.pt"):
            shutil.copyfile(inputs / filename, video_input / filename)
        video_root = video_results
        video_summary = run_video(video_input, video_root, loaded=(models, runtime))
        video_receipts = json.loads((video_root / "frame_receipts.json").read_text(encoding="utf-8"))
        callback("progress", {"progress": 85, "stage": "video-complete",
                              "frames": len(video_receipts)}, True)

    submitted = {"kind": "pinned_media_batch", "run_id": RUN_ID,
                 "source_manifest_hash": context["source_manifest_hash"], "assets": sources}
    prefix = f"website-inference/v2/jobs/{RUN_ID}/outputs/{context['source_manifest_hash']}/"
    result, uploads = build_result_v2(submitted, context["bundle"], local_code_hashes(),
                                      photo_receipts, photo_results, video_summary, video_receipts,
                                      video_root, video_input_manifest, prefix)
    upload_context = callback("prepare-pinned-uploads", {"result_manifest": result})
    upload_private(uploads, result["artifacts"], upload_context["private_uploads"])
    callback("progress", {"progress": 98, "stage": "private-artifacts-uploaded"}, True)
    completion = callback("complete-v2", {"result_manifest": result}, True)
    if not isinstance(completion, dict) or completion.get("accepted") is not True:
        raise RuntimeError("Native result completion was not accepted")
    NATIVE_COMPLETED = True
    operational = {
        "job_id": JOB_ID, "run_id": RUN_ID, "status": "callback_verified",
        "assets": len(result["assets"]), "private_artifacts": len(result["artifacts"]),
    }
    (Path("/kaggle/working") / "riceguard_private_completion.json").write_text(
        json.dumps(operational, indent=2), encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        if not NATIVE_COMPLETED:
            try:
                callback("failed", {"error": str(error)[:900]}, True)
            finally:
                raise
        # A local post-completion error cannot turn accepted inference into failed.
        print(json.dumps({"status": "post_completion_error", "inference_status": "callback_verified"}))

