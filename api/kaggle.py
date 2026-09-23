import hashlib
import hmac
import json
import os
import re
import shutil
import tempfile
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from kaggle.api.kaggle_api_extended import KaggleApi


def response_dict(value):
    if isinstance(value, dict):
        return value
    result = {}
    for name in ("version_number", "ref", "slug", "status", "error"):
        item = getattr(value, name, None)
        if item is not None:
            result[name] = item
    return result


class handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        size = int(self.headers.get("content-length", "0"))
        if size < 2 or size > 64_000:
            return self.send_json(413, {"error": "Invalid request size"})
        raw = self.rfile.read(size)
        secret = os.environ.get("KAGGLE_DISPATCH_SECRET", "")
        provided = self.headers.get("x-riceguard-signature", "")
        expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        if not secret or not hmac.compare_digest(provided, expected):
            return self.send_json(401, {"error": "Invalid dispatcher signature"})
        try:
            request = json.loads(raw)
            action = request.get("action")
            api = KaggleApi()
            api.authenticate()
            if action == "status":
                kernel_ref = str(request.get("kernel_ref", ""))
                if not re.fullmatch(r"[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+", kernel_ref):
                    raise ValueError("Invalid kernel reference")
                return self.send_json(200, response_dict(api.kernels_status(kernel_ref)))
            if action != "submit":
                return self.send_json(400, {"error": "Unsupported action"})
            job_id = str(request.get("job_id", ""))
            run_id = str(request.get("run_id", ""))
            worker_token = str(request.get("worker_token", ""))
            callback_url = str(request.get("worker_callback_url", ""))
            if not re.fullmatch(r"[0-9a-f-]{36}", job_id, re.I):
                raise ValueError("Invalid job identifier")
            if not re.fullmatch(r"rg-[a-z0-9-]{8,80}", run_id):
                raise ValueError("Invalid run identifier")
            if len(worker_token) < 32 or not callback_url.startswith("https://"):
                raise ValueError("Invalid worker credentials")
            owner = os.environ.get("KAGGLE_USERNAME", "").lower()
            slug = os.environ.get("KAGGLE_KERNEL_SLUG", "riceguard-private-inference")
            if not re.fullmatch(r"[a-z0-9_-]+", owner) or not re.fullmatch(r"[a-z0-9-]+", slug):
                raise ValueError("Kaggle owner or kernel slug is not configured")

            temp = Path(tempfile.mkdtemp(prefix="riceguard-kaggle-"))
            try:
                source = Path(__file__).resolve().parents[1] / "workers" / "kaggle" / "runner.py"
                runner = source.read_text(encoding="utf-8")
                preamble = (
                    f'JOB_ID = {job_id!r}\n'
                    f'RUN_ID = {run_id!r}\n'
                    f'WORKER_TOKEN = {worker_token!r}\n'
                    f'CALLBACK_URL = {callback_url!r}\n'
                )
                (temp / "runner.py").write_text(preamble + runner, encoding="utf-8")
                metadata = {
                    "id": f"{owner}/{slug}",
                    "title": "RiceGuard Private Inference",
                    "code_file": "runner.py",
                    "language": "python",
                    "kernel_type": "script",
                    "is_private": True,
                    "enable_gpu": True,
                    "enable_internet": True,
                    "dataset_sources": [],
                    "kernel_sources": [],
                    "competition_sources": [],
                }
                (temp / "kernel-metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
                saved = api.kernels_push(str(temp), timeout="60", acc="gpu")
                details = response_dict(saved)
                return self.send_json(200, {
                    "kernel_ref": f"{owner}/{slug}",
                    "version": details.get("version_number"),
                    "run_id": run_id,
                })
            finally:
                shutil.rmtree(temp, ignore_errors=True)
        except Exception as exc:
            message = str(exc)[:500]
            quota = any(term in message.lower() for term in ("quota", "gpu limit", "too many requests", "429"))
            return self.send_json(429 if quota else 500, {
                "error": message,
                "code": "GPU_QUOTA" if quota else "DISPATCH_FAILED",
            })
