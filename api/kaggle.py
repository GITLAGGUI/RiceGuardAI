import hashlib
import hmac
import base64
import io
import json
import os
import re
import shutil
import tempfile
import zipfile
from http.server import BaseHTTPRequestHandler
from pathlib import Path


BUNDLE_SHA256 = "0cdd9ec7c4846f5bf8c15449081bef38be1379da715f04240aab68161add86fd"
KAGGLE_RUN_TIMEOUT_SECONDS = "3600"
PINNED_SOURCES = {
    "prepare_clip.py": "workers/kaggle/prepare_clip.py",
    "pinned_video_core.py": "workers/kaggle/pinned_video_core.py",
    "pinned_photo_core.py": "workers/kaggle/pinned_photo_core.py",
    "website_adapter.py": "workers/kaggle/website_adapter.py",
    "private_upload.py": "workers/kaggle/private_upload.py",
    "website_runner.py": "workers/kaggle/website_runner.py",
    "aws_website_adapter.py": "workers/aws/website_adapter.py",
    "aws_inference_core.py": "workers/aws/inference_core.py",
    "specialists.py": "workers/kaggle/specialists.py",
    "severity.py": "workers/kaggle/severity.py",
}


def pinned_worker_package(repository_root: Path) -> tuple[str, str]:
    code_hashes = {}
    memory = io.BytesIO()
    with zipfile.ZipFile(memory, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for logical, relative in PINNED_SOURCES.items():
            source = (repository_root / relative).resolve()
            if not source.is_relative_to(repository_root.resolve()) or not source.is_file():
                raise RuntimeError("Pinned worker source is unavailable")
            raw = source.read_bytes()
            code_hashes[logical] = hashlib.sha256(raw).hexdigest()
            archive.writestr(relative.replace("\\", "/"), raw)
    descriptor = {"bundle_sha256": BUNDLE_SHA256, "code_sha256": code_hashes,
                  "fps": 30, "tile": 1024, "stride": 768,
                  "scope": "one-to-ten-photos-plus-one-optional-video"}
    workflow = hashlib.sha256(json.dumps(descriptor, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return base64.b64encode(memory.getvalue()).decode("ascii"), workflow

def response_dict(value):
    if isinstance(value, dict):
        return value
    result = {}
    for name in ("version_number", "ref", "slug", "status", "error"):
        item = getattr(value, name, None)
        if item is not None:
            if isinstance(item, (str, int, float, bool)):
                result[name] = item
            else:
                enum_name = getattr(item, "name", None)
                normalized = getattr(item, "value", None)
                result[name] = enum_name if isinstance(enum_name, str) else (
                    normalized if isinstance(normalized, (str, int, float, bool)) else str(item))
    return result


def canonical_kernel_ref(owner: str, slug: str, provider_ref: object) -> str:
    configured = f"{owner}/{slug}"
    candidate = str(provider_ref or "")
    return candidate if re.fullmatch(r"[a-z0-9_-]+/[a-z0-9_-]+", candidate) else configured


def run_scoped_kernel_slug(configured: str, run_id: str) -> str:
    """Return a bounded Kaggle slug that cannot cancel another website job.

    Kaggle treats a push to an existing kernel slug as a new version of that
    kernel. Reusing one slug for sequential website jobs can therefore cancel
    a version that is still finalizing private artifacts. Keep the readable
    configured prefix, but bind every execution to its immutable run id.
    """
    suffix = run_id.removeprefix("rg-")[-12:]
    prefix = re.sub(r"[^a-z0-9-]+", "-", configured.lower()).strip("-") or "riceguard-private"
    prefix = prefix[:36].rstrip("-")
    slug = f"{prefix}-{suffix}"
    if not re.fullmatch(r"[a-z0-9-]{3,49}", slug):
        raise ValueError("Invalid run-scoped Kaggle kernel slug")
    return slug


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
            username = os.environ.get("KAGGLE_USERNAME", "")
            credential = os.environ.get("KAGGLE_KEY") or os.environ.get("KAGGLE_API_TOKEN")
            if not username or not credential:
                return self.send_json(503, {
                    "error": "Kaggle dispatcher credentials are not configured",
                    "code": "CONFIGURATION_REQUIRED",
                })
            # Kaggle's current one-time tokens use the KGAT_ prefix and must
            # be exposed to the client as KAGGLE_API_TOKEN. Older account keys
            # continue to use KAGGLE_KEY.
            if credential.startswith("KGAT_"):
                os.environ["KAGGLE_API_TOKEN"] = credential
                os.environ.pop("KAGGLE_KEY", None)
            # Vercel's function image has a read-only home directory. Both the
            # Kaggle client and kagglehub must use the writable ephemeral area.
            os.environ["HOME"] = "/tmp"
            os.environ["KAGGLE_CONFIG_DIR"] = "/tmp/.kaggle"
            os.environ["KAGGLEHUB_CACHE"] = "/tmp/kagglehub"
            Path("/tmp/.kaggle").mkdir(parents=True, exist_ok=True)
            Path("/tmp/kagglehub").mkdir(parents=True, exist_ok=True)

            # The Kaggle package authenticates while its top-level package is
            # imported. Keep the import behind our request authentication and
            # configuration checks so a missing provider credential cannot
            # crash the whole Vercel function before it can return JSON.
            try:
                from kaggle.api.kaggle_api_extended import KaggleApi
            except Exception as exc:
                return self.send_json(503, {
                    "error": f"Kaggle client initialization failed: {str(exc)[:300]}",
                    "code": "PROVIDER_UNAVAILABLE",
                })
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
            requested_workflow = str(request.get("workflow_sha256", ""))
            repository_root = Path(__file__).resolve().parents[1]
            worker_package, actual_workflow = pinned_worker_package(repository_root)
            if not re.fullmatch(r"[0-9a-f-]{36}", job_id, re.I):
                raise ValueError("Invalid job identifier")
            if not re.fullmatch(r"rg-[a-z0-9-]{8,80}", run_id):
                raise ValueError("Invalid run identifier")
            if len(worker_token) < 32 or not callback_url.startswith("https://"):
                raise ValueError("Invalid worker credentials")
            if requested_workflow != actual_workflow:
                raise ValueError("Pinned worker workflow does not match the authorized job")
            owner = username.lower()
            slug = run_scoped_kernel_slug(
                os.environ.get("KAGGLE_KERNEL_SLUG", "riceguard-pinned-private-inference"),
                run_id,
            )
            if not re.fullmatch(r"[a-z0-9_-]+", owner) or not re.fullmatch(r"[a-z0-9-]+", slug):
                raise ValueError("Kaggle owner or kernel slug is not configured")

            temp = Path(tempfile.mkdtemp(prefix="riceguard-kaggle-"))
            try:
                runner = (
                    "import base64,io,os,runpy,sys,zipfile\n"
                    f"payload={worker_package!r}\n"
                    "root='/kaggle/working/riceguard_code'\n"
                    "zipfile.ZipFile(io.BytesIO(base64.b64decode(payload))).extractall(root)\n"
                    "sys.path.insert(0,root)\n"
                    f"os.environ['RICEGUARD_JOB_ID']={job_id!r}\n"
                    f"os.environ['RICEGUARD_RUN_ID']={run_id!r}\n"
                    f"os.environ['RICEGUARD_WORKER_TOKEN']={worker_token!r}\n"
                    f"os.environ['RICEGUARD_CALLBACK_URL']={callback_url!r}\n"
                    "runpy.run_module('workers.kaggle.website_runner',run_name='__main__')\n"
                )
                (temp / "runner.py").write_text(runner, encoding="utf-8")
                metadata = {
                    "id": f"{owner}/{slug}",
                    # Kaggle derives a new notebook's public slug from title,
                    # even when metadata.id contains the desired slug. Keep
                    # them identical so the returned status reference is real.
                    "title": slug,
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
                # Native multi-photo inference and private artifact transfer
                # legitimately exceed one minute. This is a ceiling, not a
                # billing reservation; the script exits immediately on finish.
                saved = api.kernels_push(str(temp), timeout=KAGGLE_RUN_TIMEOUT_SECONDS, acc="gpu")
                details = response_dict(saved)
                # Recent Kaggle clients may return a URL or display-form ref.
                # The push target is already fixed by kernel-metadata.json, so
                # retain a canonical provider identifier for reconciliation.
                actual_ref = canonical_kernel_ref(owner, slug, details.get("ref"))
                return self.send_json(200, {
                    "kernel_ref": actual_ref,
                    "version": details.get("version_number"),
                    "run_id": run_id,
                    "workflow_sha256": actual_workflow,
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
