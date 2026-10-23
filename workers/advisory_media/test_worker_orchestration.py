"""Synthetic post-inference orchestration tests; never import the GPU runner."""

import ast
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import re
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from PIL import Image

from workers.advisory_media.orchestration import prepare_advisory_media


SURVEY = "11111111-1111-4111-8111-111111111111"
JOB = "22222222-2222-4222-8222-222222222222"
ASSET = "33333333-3333-4333-8333-333333333333"
RUN = "rg-orchestration-fixture"


class OrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / "advisory-media"
        self.context = {"advisory_media_enabled": True, "survey_id": SURVEY}
        self.completion = {"accepted": True, "result_revision": 4}
        self.result = {"schema_version": "riceguard.result.v2", "run_id": RUN, "artifacts": {},
                       "assets": [{"kind": "image", "source_asset_id": ASSET, "status": "complete", "review_paths": {}}]}
        self.uploads = {}
        for variant in ("original", "combined"):
            source = self.root / (variant + ".jpg")
            Image.new("RGB", (64, 48), "green").save(source)
            key = f"website-inference/v2/jobs/{RUN}/outputs/{ASSET}/{variant}.jpg"
            blob = source.read_bytes()
            self.result["artifacts"][key] = {"sha256": sha256(blob).hexdigest(), "bytes": len(blob)}
            self.result["assets"][0]["review_paths"][variant] = key
            self.uploads[key] = source
        self.calls = [("complete-v2", deepcopy(self.completion))]

    def callback(self, action, payload):
        self.calls.append((action, deepcopy(payload)))
        if action == "prepare-advisory-media":
            return {"private_uploads": {entry["path"]: "https://private.invalid/?secret=do-not-log" for entry in payload["catalogue"]["entries"]}}
        if action == "complete-advisory-media":
            return {"stored": True, "catalogue_sha256": "a" * 64,
                    "event": {"event_id": "44444444-4444-4444-8444-444444444444", "status": "pending", "duplicate": False}}
        raise AssertionError("Unexpected callback")

    def upload(self, uploads, receipts, urls):
        self.calls.append(("upload", list(uploads)))
        self.assertEqual(set(uploads), set(receipts))
        self.assertEqual(set(uploads), set(urls))
        for key, path in uploads.items():
            self.assertEqual(receipts[key], {"sha256": sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size})

    def run_flow(self, **kwargs):
        return prepare_advisory_media(self.result, self.uploads, self.output, context=self.context,
                                     job_id=JOB, completion=self.completion,
                                     callback=kwargs.pop("callback", self.callback),
                                     upload_private=kwargs.pop("upload_private", self.upload), **kwargs)

    def assert_safe_failure(self, result, code):
        self.assertEqual(result, {"status": "advisory_media_failed", "error_code": code})
        self.assertNotIn("private.invalid", json.dumps(result))
        self.assertNotIn(str(self.root), json.dumps(result))
        self.assertEqual(self.completion, {"accepted": True, "result_revision": 4})
        self.assertNotIn("failed", [call[0] for call in self.calls])

    def test_callback_upload_order_and_native_sources_preserved(self):
        native = deepcopy(self.result)
        native_bytes = {key: path.read_bytes() for key, path in self.uploads.items()}
        result = self.run_flow()
        self.assertEqual([call[0] for call in self.calls], ["complete-v2", "prepare-advisory-media", "upload", "complete-advisory-media"])
        self.assertEqual(result, {"status": "advisory_media_stored", "catalogue_sha256": "a" * 64,
                                  "event_recorded": True, "event_status": "pending"})
        self.assertEqual(self.result, native)
        self.assertEqual(native_bytes, {key: path.read_bytes() for key, path in self.uploads.items()})

    def test_off_flag_preserves_old_behavior_without_build_or_callbacks(self):
        for value in (False, None, "true"):
            self.context["advisory_media_enabled"] = value
            with patch("workers.advisory_media.orchestration.build_catalogue") as builder:
                self.assertEqual(self.run_flow(), {"status": "disabled"})
                builder.assert_not_called()
            self.assertFalse(self.output.exists())
        self.assertEqual(len(self.calls), 1)

    def test_native_revision_and_acceptance_are_required(self):
        for completion in ({}, {"accepted": False, "result_revision": 4}, {"accepted": True},
                           {"accepted": True, "result_revision": True}, {"accepted": True, "result_revision": 0}):
            self.completion = completion
            result = self.run_flow()
            self.assertEqual(result, {"status": "advisory_media_failed", "error_code": "ADVISORY_MEDIA_REVISION_REQUIRED"})
            self.assertFalse(self.output.exists())
        self.assertEqual(len(self.calls), 1)

    def test_prepare_upload_and_finish_errors_do_not_fail_inference(self):
        for stage, code in (("prepare-advisory-media", "ADVISORY_MEDIA_PREPARE_FAILED"),
                            ("upload", "ADVISORY_MEDIA_UPLOAD_FAILED"),
                            ("complete-advisory-media", "ADVISORY_MEDIA_COMPLETE_FAILED")):
            with self.subTest(stage=stage):
                self.output = self.root / stage
                self.calls = [("complete-v2", deepcopy(self.completion))]
                def callback(action, payload):
                    if action == stage:
                        self.calls.append((action, {}))
                        raise RuntimeError("private token https://private.invalid/path")
                    return self.callback(action, payload)
                uploader = Mock(side_effect=RuntimeError("secret signed URL")) if stage == "upload" else self.upload
                result = self.run_flow(callback=callback, upload_private=uploader)
                self.assert_safe_failure(result, code)
                if stage != "complete-advisory-media":
                    self.assertNotIn("complete-advisory-media", [call[0] for call in self.calls])

    def test_build_failure_is_bounded(self):
        with patch("workers.advisory_media.orchestration.build_catalogue", side_effect=RuntimeError("secret local path")):
            self.assert_safe_failure(self.run_flow(), "ADVISORY_MEDIA_BUILD_FAILED")
        self.assertEqual(len(self.calls), 1)

    def test_duplicate_retries_reuse_same_catalogue_and_existing_files(self):
        callback = Mock(side_effect=RuntimeError("first prepare fails"))
        self.assert_safe_failure(self.run_flow(callback=callback), "ADVISORY_MEDIA_PREPARE_FAILED")
        first_catalogue = callback.call_args.args[1]["catalogue"]
        before = {path.relative_to(self.output): (path.read_bytes(), path.stat().st_mtime_ns) for path in self.output.rglob("*") if path.is_file()}
        with patch("workers.advisory_media.orchestration.build_catalogue", side_effect=AssertionError("must reuse")):
            self.assertEqual(self.run_flow()["status"], "advisory_media_stored")
            self.assertEqual(self.run_flow()["status"], "advisory_media_stored")
        catalogues = [call[1]["catalogue"] for call in self.calls if call[0] == "prepare-advisory-media"]
        self.assertTrue(all(item == first_catalogue for item in catalogues))
        after = {path.relative_to(self.output): (path.read_bytes(), path.stat().st_mtime_ns) for path in self.output.rglob("*") if path.is_file()}
        self.assertEqual(before, after)

    def test_cached_files_and_revision_cannot_be_silently_replaced(self):
        self.run_flow()
        file = next(self.output.rglob("overview.jpg"))
        file.write_bytes(b"changed")
        self.assert_safe_failure(self.run_flow(), "ADVISORY_MEDIA_BUILD_FAILED")
        self.completion["result_revision"] = 5
        result = self.run_flow()
        self.assertEqual(result["status"], "advisory_media_failed")

    def test_complete_response_needs_verified_storage_receipt(self):
        for response in ({"stored": False}, {"stored": True, "catalogue_sha256": "bad", "event": None},
                         {"stored": True, "catalogue_sha256": "a" * 64, "event": "fake"}):
            def callback(action, payload):
                return response if action == "complete-advisory-media" else self.callback(action, payload)
            self.assert_safe_failure(self.run_flow(callback=callback), "ADVISORY_MEDIA_COMPLETE_FAILED")

    def test_no_event_is_not_reported_as_ready(self):
        def callback(action, payload):
            return {"stored": True, "catalogue_sha256": "a" * 64, "event": None} if action == "complete-advisory-media" else self.callback(action, payload)
        result = self.run_flow(callback=callback)
        self.assertFalse(result["event_recorded"])
        self.assertIsNone(result["event_status"])

    def test_awaiting_authorization_is_explicit_and_has_no_recorded_event(self):
        def callback(action, payload):
            return {"stored": True, "catalogue_sha256": "a" * 64,
                    "event": {"event_id": None, "status": "awaiting_authorization", "duplicate": False}} if action == "complete-advisory-media" else self.callback(action, payload)
        result = self.run_flow(callback=callback)
        self.assertEqual(result["status"], "advisory_media_stored")
        self.assertFalse(result["event_recorded"])
        self.assertEqual(result["event_status"], "awaiting_authorization")

    def test_malformed_event_receipts_fail_and_valid_event_states_are_recorded(self):
        event_id = "44444444-4444-4444-8444-444444444444"
        invalid = ({}, {"id": event_id}, {"event_id": "bad", "status": "pending"},
                   {"event_id": None, "status": "pending"}, {"event_id": event_id, "status": "unknown"},
                   {"event_id": event_id, "status": "awaiting_authorization"})
        for event in invalid:
            with self.subTest(event=event):
                def callback(action, payload):
                    return {"stored": True, "catalogue_sha256": "a" * 64, "event": event} if action == "complete-advisory-media" else self.callback(action, payload)
                self.assert_safe_failure(self.run_flow(callback=callback), "ADVISORY_MEDIA_COMPLETE_FAILED")
        for status in ("pending", "leased", "notified", "failed"):
            with self.subTest(status=status):
                def callback(action, payload):
                    return {"stored": True, "catalogue_sha256": "a" * 64,
                            "event": {"event_id": event_id, "status": status}} if action == "complete-advisory-media" else self.callback(action, payload)
                result = self.run_flow(callback=callback)
                self.assertTrue(result["event_recorded"])
                self.assertEqual(result["event_status"], status)

    def test_runner_main_completes_native_before_advisory_error(self):
        runner = Path(__file__).resolve().parents[1] / "kaggle/website_runner.py"
        tree = ast.parse(runner.read_text(encoding="utf-8"))
        main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "main")
        # Compile the real main function alone: skip module-level pip/imports and
        # inject every network/model boundary. Only temporary local files exist.
        working, completion_dir = self.root / "runner", self.root / "completion"
        working.mkdir()
        completion_dir.mkdir()
        context = {**self.context, "source_manifest": {"assets": []}, "run_id": RUN,
                   "source_manifest_hash": "f" * 64,
                   "bundle": {"models": {name: {"sha256": "f" * 64} for name in ("BLB", "Brown Spot")}},
                   "model_downloads": {"BLB": "unused", "Brown Spot": "unused"}}
        actions = []
        def callback(action, payload=None, sequenced=False):
            actions.append(action)
            if action == "manifest-pinned":
                return context
            if action == "prepare-pinned-uploads":
                return {"private_uploads": {}}
            if action == "complete-v2":
                return self.completion
            if action == "prepare-advisory-media":
                raise RuntimeError("secret signed URL must not reach completion status")
            return {}
        namespace = {"re": re, "json": json, "JOB_ID": JOB, "RUN_ID": RUN,
                     "WORKER_TOKEN": "t" * 32, "CALLBACK_URL": "https://callback.invalid",
                     "NATIVE_COMPLETED": False, "callback": callback,
                     "Path": lambda value: completion_dir if str(value) == "/kaggle/working" else Path(value),
                     "tempfile": SimpleNamespace(mkdtemp=lambda **kwargs: str(working)),
                     "download": Mock(), "load_models": Mock(return_value=({}, {})),
                     "run_photos": Mock(return_value=[]), "local_code_hashes": Mock(return_value={}),
                     "build_result_v2": Mock(return_value=(self.result, self.uploads)),
                     "upload_private": Mock(), "prepare_advisory_media": prepare_advisory_media}
        exec(compile(ast.Module(body=[main], type_ignores=[]), str(runner), "exec"), namespace)
        namespace["main"]()
        self.assertTrue(namespace["NATIVE_COMPLETED"])
        self.assertLess(actions.index("complete-v2"), actions.index("prepare-advisory-media"))
        self.assertNotIn("failed", actions)
        status = json.loads((completion_dir / "riceguard_private_completion.json").read_text())
        self.assertEqual(status["status"], "advisory_media_failed")
        self.assertEqual(status["inference_status"], "callback_verified")
        self.assertEqual(status["advisory_media"]["error_code"], "ADVISORY_MEDIA_PREPARE_FAILED")
        self.assertNotIn("secret", json.dumps(status))
        namespace["load_models"].assert_called_once()
        namespace["run_photos"].assert_called_once()

    def test_runner_outer_guard_never_marks_completed_inference_failed(self):
        runner = Path(__file__).resolve().parents[1] / "kaggle/website_runner.py"
        tree = ast.parse(runner.read_text(encoding="utf-8"))
        entrypoint = tree.body[-1]
        self.assertIsInstance(entrypoint, ast.If)
        callback, printer = Mock(), Mock()
        namespace = {"__name__": "__main__", "main": Mock(side_effect=RuntimeError("private path")),
                     "NATIVE_COMPLETED": True, "callback": callback, "print": printer, "json": json}
        exec(compile(ast.Module(body=[entrypoint], type_ignores=[]), str(runner), "exec"), namespace)
        callback.assert_not_called()
        status = json.loads(printer.call_args.args[0])
        self.assertEqual(status["error_code"], "ADVISORY_MEDIA_POST_COMPLETION_FAILED")
        self.assertNotIn("private path", json.dumps(status))
        namespace["NATIVE_COMPLETED"] = False
        with self.assertRaises(RuntimeError):
            exec(compile(ast.Module(body=[entrypoint], type_ignores=[]), str(runner), "exec"), namespace)
        self.assertEqual(callback.call_args.args[0], "failed")


if __name__ == "__main__":
    unittest.main()
