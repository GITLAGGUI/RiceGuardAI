"""One-at-a-time private AWS validation of the user's 10 photos and 31 s clip.

This driver preserves receipts and stops on any failure or insufficient credits.
It never activates website processing, publishes a bulletin, or sends SMS.
"""

import json
import os
from pathlib import Path
import time

import test_field_media as photos
import test_video_media as video


ROOT = Path(__file__).resolve().parents[3]
TEST_ROOT = ROOT / "research" / "website_validation_20260928"
PHOTO_INPUTS = TEST_ROOT / "inputs"
PHOTO_OUTPUTS = TEST_ROOT / "results"
VIDEO_INPUTS = TEST_ROOT / "video_frames"
VIDEO_OUTPUTS = TEST_ROOT / "results" / "video_frames"
VIDEO_OUTPUT = TEST_ROOT / "results" / "field_video_104s_to_135s_4k_5fps_review.mp4"
LOCK = TEST_ROOT / "media_test.lock"
MIN_REMAINING_CREDITS_USD = 100


def emit(value):
    print(json.dumps(value), flush=True)


def credit_guard():
    remaining = photos.session.client("freetier").get_account_plan_state()["accountPlanRemainingCredits"]["amount"]
    if remaining < MIN_REMAINING_CREDITS_USD:
        raise RuntimeError("Private AWS credit reserve reached; no new test jobs submitted")


def wait_photo(group):
    while True:
        receipt = photos.read_json(photos.receipt_key(group))
        if not receipt.get("job_id"):
            raise RuntimeError("Interrupted photo submission needs manual reconciliation")
        jobs = photos.batch.describe_jobs(jobs=[receipt["job_id"]])["jobs"]
        if len(jobs) != 1:
            raise RuntimeError("Photo receipt does not match one AWS job")
        status = jobs[0]["status"]
        if status == "SUCCEEDED":
            photos.status(group, verify=True)
            photos.save_review_preview(group, PHOTO_OUTPUTS)
            return
        if status == "FAILED":
            raise RuntimeError(f"Photo group {group + 1} failed: {jobs[0].get('statusReason')}")
        time.sleep(30)


def run():
    photos.check_account_and_privacy()
    if len(list(VIDEO_INPUTS.glob("frame_*.jpg"))) != video.FRAME_COUNT:
        raise RuntimeError("The selected 31-second, 5 fps interval is incomplete")
    for group in range(len(photos.GROUPS)):
        try:
            receipt = photos.read_json(photos.receipt_key(group))
        except photos.ClientError as error:
            if error.response["Error"]["Code"] not in ("NoSuchKey", "404"):
                raise
            receipt = None
        if receipt is None:
            credit_guard()
            photos.submit(group, PHOTO_INPUTS)
        wait_photo(group)
        emit({"stage": "photos", "groups_verified": group + 1, "total_groups": len(photos.GROUPS)})
    credit_guard()
    video.run_all(VIDEO_INPUTS, VIDEO_OUTPUTS)
    video.assemble(VIDEO_OUTPUTS, VIDEO_OUTPUT)
    emit({"status": "all_private_field_media_verified", "photos": 10,
          "video_interval_seconds": [104, 135], "video_frames": video.FRAME_COUNT,
          "website_activated": False, "staff_review_required": True})


if __name__ == "__main__":
    TEST_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(LOCK, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise SystemExit("Another media test driver may be active; inspect the lock and process first")
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(str(os.getpid()))
        run()
    finally:
        if LOCK.exists() and LOCK.read_text().strip() == str(os.getpid()):
            LOCK.unlink()
