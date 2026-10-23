"""Recompute the Kaggle workflow pin and write it everywhere it is checked.

Run after any change to a packaged worker file. The pin binds the model bundle and the
exact worker sources; the dispatcher, callback validator and SQL completion all compare it.
"""
import importlib.util
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("kaggle_api", root / "api" / "kaggle.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
_, workflow = module.pinned_worker_package(root)
targets = {
    root / "supabase/functions/_shared/pinnedResult.ts":
        r'(export const PINNED_KAGGLE_WORKFLOW_SHA256 = ")([^"]*)(")',
    root / "supabase/migrations/20261023170000_full_automation_v3.sql":
        r"(coalesce\(j\.manifest->>'pinned_workflow_sha256', ''\) not in \(')([^']*)(')",
}
for path, pattern in targets.items():
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, lambda m: m.group(1) + workflow + m.group(3), text, count=1)
    if count != 1:
        raise SystemExit(f"pin marker not found in {path}")
    path.write_text(updated, encoding="utf-8", newline="\n")
print(workflow)
