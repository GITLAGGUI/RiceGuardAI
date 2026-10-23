"""Compare the private AWS smoke masks to these exact local checkpoints."""
import hashlib
import io
import json
from pathlib import Path

import boto3
import numpy as np
from PIL import Image
import torch
from ultralytics import YOLO

from inference_core import inspect_image, stitch
from publish_bundle import MODELS, ROOT, BUCKET, PREFIX
from smoke_worker import RUN


def main():
    torch.set_num_threads(2)
    s3 = boto3.client("s3", region_name="us-east-1")
    receipt = json.loads(s3.get_object(Bucket=BUCKET, Key=f"{PREFIX}/jobs/{RUN}/submission.json")["Body"].read())
    manifest = json.loads(s3.get_object(Bucket=BUCKET, Key=f"{PREFIX}/jobs/{RUN}/manifest.json")["Body"].read())
    result = json.loads(s3.get_object(Bucket=BUCKET, Key=f"{PREFIX}/jobs/{RUN}/outputs/{receipt['manifest_sha256']}/result.json")["Body"].read())
    original = s3.get_object(Bucket=BUCKET, Key=manifest["assets"][0]["key"])["Body"].read()
    image, _ = inspect_image(io.BytesIO(original))
    for finding in result["assets"][0]["diseases"]:
        disease = finding["disease"]
        relative, sha, _ = MODELS[disease]
        path = ROOT / relative
        with path.open("rb") as f:
            assert hashlib.file_digest(f, "sha256").hexdigest() == sha
        model = YOLO(str(path))
        local = stitch(image, lambda tile: model.predict(tile, imgsz=1024, device="cpu", verbose=False)[0].semantic_mask.data.cpu().numpy())
        aws = s3.get_object(Bucket=BUCKET, Key=finding["mask_path"])["Body"].read()
        with Image.open(io.BytesIO(aws)) as im:
            remote = np.asarray(im) == 255
        different = int((local != remote).sum())
        union = int((local | remote).sum())
        iou = float((local & remote).sum() / union) if union else 1.0
        print(json.dumps({"disease": disease, "different_pixels": different, "mask_iou": iou,
                          "local_predicted_pixels": int(local.sum()), "aws_predicted_pixels": int(remote.sum())}), flush=True)
        if iou < .995:
            raise RuntimeError("AWS/local parity failed; do not activate")


if __name__ == "__main__":
    main()
