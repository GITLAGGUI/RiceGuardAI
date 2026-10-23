"""Optional post-completion media preparation with injected authenticated I/O.

This module never runs inference and never sends an inference-failed callback.
The caller must successfully complete the native result before invoking it.
Retries reuse one local catalogue and derivative set; the server remains the
authority for upload authorization, revision binding and event idempotency.
"""

from hashlib import sha256
import json
from pathlib import Path
import re
from uuid import UUID

from .catalogue import build_catalogue
from .derivatives import _read_verified, _reject_links


PLAN_FILENAME = "local-plan.json"
MAX_PLAN_BYTES = 128 * 1024
EVENT_STATUSES = ("pending", "leased", "notified", "failed")


def _event_receipt(event) -> tuple[bool, str | None]:
    if event is None:
        return False, None
    if not isinstance(event, dict) or "event_id" not in event or "status" not in event:
        raise ValueError("invalid event receipt")
    event_id, status = event["event_id"], event["status"]
    if status == "awaiting_authorization" and event_id is None:
        return False, status
    if status not in EVENT_STATUSES or not isinstance(event_id, str):
        raise ValueError("invalid event identity or status")
    UUID(event_id)
    return True, status


def _digest(value: dict) -> str:
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _uploads(catalogue: dict, root: Path, result: dict) -> dict[str, Path]:
    expected = []
    index = 0
    for asset in result["assets"]:
        if asset["kind"] != "image":
            continue
        index += 1
        asset_id = str(UUID(asset["source_asset_id"]))
        for variant in ("original", "combined"):
            source_hash = result["artifacts"][asset["review_paths"][variant]]["sha256"]
            target = f"website-inference/v2/jobs/{result['run_id']}/outputs/advisory-media/visual-v1/{asset_id}/{variant}.jpg"
            expected.append((asset_id, index, variant, source_hash, target))
    entries = catalogue["entries"]
    actual = [(entry["source_asset_id"], entry["image_index"], entry["variant"], entry["source_sha256"], entry["path"]) for entry in entries]
    if not expected or actual != expected:
        raise ValueError("cached catalogue does not match native photo variants")
    uploads = {}
    for entry in entries:
        file = root / entry["source_asset_id"] / entry["variant"] / "overview.jpg"
        data = _read_verified(file, entry["sha256"])
        if len(data) != entry["bytes"]:
            raise ValueError("cached derivative changed")
        uploads[entry["path"]] = file
    return uploads


def _plan(result: dict, local_artifacts: dict[str, Path], root: Path, *, survey_id: str,
          job_id: str, revision: int) -> tuple[dict, dict[str, Path]]:
    root = Path(root).absolute()
    _reject_links(root)
    binding = _digest({"result": result, "survey_id": survey_id, "job_id": job_id, "result_revision": revision})
    cache_file = root / PLAN_FILENAME
    if root.exists():
        _reject_links(cache_file)
        if not root.is_dir() or not cache_file.is_file():
            raise ValueError("existing output has no complete local catalogue plan")
        with cache_file.open("rb") as stream:
            raw = stream.read(MAX_PLAN_BYTES + 1)
        if len(raw) > MAX_PLAN_BYTES:
            raise ValueError("local catalogue plan exceeds bounded size")
        saved = json.loads(raw)
        catalogue = saved["catalogue"]
        if (saved.get("schema_version") != "riceguard.advisory.local-plan.v1" or
                saved.get("binding_sha256") != binding or saved.get("catalogue_sha256") != _digest(catalogue)):
            raise ValueError("existing catalogue plan has different native result binding")
        if (catalogue.get("schema_version") != "riceguard.advisory.catalogue.v1" or
                catalogue.get("policy_version") != "visual-v1" or catalogue.get("survey_id") != str(UUID(survey_id)) or
                catalogue.get("job_id") != str(UUID(job_id)) or catalogue.get("result_revision") != revision):
            raise ValueError("existing catalogue identity changed")
        return catalogue, _uploads(catalogue, root, result)
    catalogue, uploads = build_catalogue(result, local_artifacts, root, survey_id=survey_id,
                                         job_id=job_id, result_revision=revision)
    saved = {"schema_version": "riceguard.advisory.local-plan.v1", "binding_sha256": binding,
             "catalogue_sha256": _digest(catalogue), "catalogue": catalogue}
    encoded = json.dumps(saved, sort_keys=True, separators=(",", ":")).encode()
    if len(encoded) > MAX_PLAN_BYTES:
        raise ValueError("local catalogue plan exceeds bounded size")
    _reject_links(cache_file)
    with cache_file.open("xb") as stream:
        stream.write(encoded)
    return catalogue, uploads


def prepare_advisory_media(result: dict, local_artifacts: dict[str, Path], output_root: Path, *,
                           context: dict, job_id: str, completion: dict,
                           callback, upload_private) -> dict:
    """Return bounded operational status after native inference has completed.

    Exceptions never leak exception messages, native paths, signed URLs or tokens
    into status. Advisory failure leaves the successful native result intact.
    """
    if context.get("advisory_media_enabled") is not True:
        return {"status": "disabled"}
    revision = completion.get("result_revision") if isinstance(completion, dict) else None
    if not isinstance(completion, dict) or completion.get("accepted") is not True or type(revision) is not int or revision < 1:
        return {"status": "advisory_media_failed", "error_code": "ADVISORY_MEDIA_REVISION_REQUIRED"}
    stage = "BUILD"
    try:
        catalogue, uploads = _plan(result, local_artifacts, output_root, survey_id=context["survey_id"],
                                   job_id=job_id, revision=revision)
        receipts = {entry["path"]: {"sha256": entry["sha256"], "bytes": entry["bytes"]} for entry in catalogue["entries"]}
        stage = "PREPARE"
        prepared = callback("prepare-advisory-media", {"catalogue": catalogue})
        urls = prepared["private_uploads"]
        if not isinstance(urls, dict) or set(urls) != set(uploads):
            raise ValueError("private upload set is incomplete")
        stage = "UPLOAD"
        upload_private(uploads, receipts, urls)
        stage = "COMPLETE"
        finished = callback("complete-advisory-media", {"catalogue": catalogue})
        digest = finished.get("catalogue_sha256")
        event = finished["event"]
        if (finished.get("stored") is not True or not isinstance(digest, str) or
                not re.fullmatch(r"[a-f0-9]{64}", digest)):
            raise ValueError("server did not confirm complete catalogue storage")
        recorded, event_status = _event_receipt(event)
        return {"status": "advisory_media_stored", "catalogue_sha256": digest,
                "event_recorded": recorded, "event_status": event_status}
    except Exception:
        return {"status": "advisory_media_failed", "error_code": f"ADVISORY_MEDIA_{stage}_FAILED"}
