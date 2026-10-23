"""Transfer verified local review artifacts through short-lived private PUT URLs.

No AWS credentials, Kaggle API token, or public bucket permissions are needed
inside the inference notebook. The authenticated callback issues only keys
for the immutable job result and S3 independently validates SHA-256 on PUT.
"""

from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import time

import requests

from .prepare_clip import digest


def _upload_one(key: str, source: Path, expected: dict, url: str) -> str:
    path = Path(source)
    if not path.is_file() or path.stat().st_size != expected.get("bytes") or digest(path) != expected.get("sha256"):
        raise ValueError("Local artifact changed after the result manifest was built")
    if not isinstance(url, str) or not url.startswith("https://") or "X-Amz-Signature=" not in url:
        raise ValueError("Private presigned upload URL is invalid")
    checksum = base64.b64encode(bytes.fromhex(expected["sha256"])).decode("ascii")
    last_error = "upload did not start"
    for attempt in range(3):
        try:
            with path.open("rb") as stream:
                response = requests.put(url, data=stream, headers={
                    "Content-Length": str(expected["bytes"]),
                    "x-amz-checksum-sha256": checksum,
                    "x-amz-server-side-encryption": "AES256",
                }, timeout=(15, 120))
            if response.status_code in (200, 201):
                return key
            last_error = f"HTTP {response.status_code}"
            if response.status_code not in (408, 429, 500, 502, 503, 504):
                break
        except requests.RequestException as error:
            last_error = type(error).__name__
        if attempt < 2:
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Private S3 upload failed for an artifact after retries: {last_error}")


def upload_private(uploads: dict[str, Path], receipts: dict[str, dict], signed_urls: dict[str, str]) -> list[str]:
    if not uploads or set(uploads) != set(receipts) or set(uploads) != set(signed_urls):
        raise ValueError("Private upload URLs do not match the complete artifact set")
    ordered = list(uploads)
    with ThreadPoolExecutor(max_workers=min(4, len(ordered))) as pool:
        futures = {
            key: pool.submit(_upload_one, key, uploads[key], receipts[key], signed_urls[key])
            for key in ordered
        }
        return [futures[key].result() for key in ordered]

