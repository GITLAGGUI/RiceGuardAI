# RiceGuardAI Gemini connector: local implementation checkpoint

Date: October 23, 2026 (Philippines)

Update: The user subsequently approved deployment, which has now completed.
See `gemini-connector-live-receipt.md` for verified live routes, remote migration
version mapping, security findings and the remaining actual Gemini consent gate.
The initial local-only notes below are historical, not current deployment status.

## What this release does

Provides four MCP tools: scoped queue summary, permitted result listing, exact
revision evidence reading, and private advisory submission. It does not publish,
send SMS, verify findings, create a Gmail monitor, or call a Gemini API. A Gemini
subscription is not treated as an API credential or proof of unattended triggers.

Owner approval requires an active administrator, verified MFA, explicit survey
selection, and a separate image choice (off initially). Access and refresh tokens
are isolated opaque credentials stored as hashes. Grants expire and can be revoked.
Reused refresh credentials revoke the token family. Responses do not expose farm
coordinates, contact records, raw private notes or storage paths.

Private submissions bind the survey, job, exact revision, approved guidance and
context digest. Duplicate submissions return the existing receipt. Changed
evidence requires a new read. A model name supplied by an LLM is self-reported;
the database does not manufacture a verified `4 Argon` selection.

## Images and scientific limits

Only consented, bounded JPEG/PNG derivatives with manifest hashes are eligible.
Foreign hosts, redirects, excess bytes, metadata-bearing images and hash mismatch
are rejected. Missing trusted derivative hashes means text-only evidence, not a
claim that Gemini inspected an image. Configure exact trusted hosts privately.
BLB region coverage and Brown Spot affected-leaf coverage are different measures;
neither is established as calibrated lesion severity or field prevalence.

## Local verification

Deno 2.9.6; pinned MCP SDK 1.32.1, Zod 4.6.7, Supabase JS 2.57.4.
The connector entrypoint typechecks. The backend suite passed 33 tests, including
the real handler/store/SQL round trip using an isolated loopback PGlite fixture.
The fixture replaces Supabase session verification: it is not evidence of live
MFA, real Gemini consent, independent PostgreSQL session races or working hosting.

Run from the isolated checkout using Deno and its private cache:

```
deno check --config supabase/functions/advisory-mcp/deno.json supabase/functions/advisory-mcp/index.ts
deno test --config supabase/functions/advisory-mcp/deno.json --allow-net=127.0.0.1 --allow-run=node supabase/functions/advisory-mcp/tests
```

The latest targeted frontend run passed 49 tests (19 SQL, 30 UI) using one thread
worker at a time. The earlier fork worker startup timed out; the passing rerun
used `--maxWorkers=1 --pool=threads`. The production build passed, with an existing
large-chunk warning. These results do not establish live browser functionality
or a fully green repository-wide test/lint run.

The additional existing advisory/review regression set passed35 tests across
three files using the same thread-worker setting. Targeted six-file frontend
ESLint passed. Independent read-only review findings were reproduced and fixed;
the reviewer rechecked both fixes. Source hashes are recorded separately in
`gemini-connector-source-hashes.json`; they are a local QA checkpoint, not approval
to deploy copied baseline files. Browser/accessibility and live checks remain.

## Release gate and configuration

No schema, function, rewrite or frontend change has been deployed by this task.
The isolated worktree also contains copied pre-existing source changes. Never
deploy the entire dirty tree or apply every pending migration. First assemble an
explicit release against the actual deployed baseline and review its exact diff.

Intended target is existing Supabase project `pekowozxnyyeskymjxyx` and
`https://riceguardai.dev`. The new function is `advisory-mcp`, with only its
gateway JWT check disabled because it implements its own isolated OAuth checks.
Existing functions retain their settings. Explicit discovery/OAuth/MCP rewrites
must precede the existing SPA fallback. Test the deployed redirects and Origin
headers: local handler tests alone cannot establish reverse-proxy behavior.

The entrypoint fails closed unless `RG_GEMINI_CONNECTOR_ENABLED=true`,
`RG_GEMINI_CONNECTOR_OWNER_ID` and normal Supabase server credentials exist.
`RG_GEMINI_MEDIA_HOSTS` is a comma-separated exact-host allowlist; leave empty for
text-only. Existing private AWS signing configuration is needed for media only.
Never copy credential values into this document or browser code.

Before deployment: obtain action-time approval for the exact isolated release,
inspect migration dry-run/security advisors and run live regression checks.
After deployment: verify discovery JSON, anonymous denial, existing pages and
scoped owner consent. Capture the actual Gemini Google callback and register
that exact URI; no Google Cloud project or Gemini API key is required by this code.
The human must perform the real Allow and any write confirmation. Verify `4 Argon`
in the actual Gemini UI; never infer the selection from a database default.

Run exactly one approved private test, match its stored receipt and prove no
bulletin/SMS records changed before calling the connection verified. If Gemini
cannot use the tools, report that limitation rather than switching products.

## Disable or revoke

Disable the connector with its enable flag and revoke connector grants through
the owner screen. Remove only the connector rewrites if necessary. Do not delete
user data, broadly revert migrations or reset the working tree as rollback.

## Remaining broader requirements

These are separate later phases, not completed by a private MCP connector:

- Upload-triggered orchestration, Drive/Kaggle outputs, and verified Gemini Task
  trigger support without an API key; an MCP tool alone does not provide a trigger.
- Automatic provisional bulletin publication and consented SMS with retries,
  duplicate prevention, audit trail and optional specialist correction/retraction.
- EXIF-based coordinates and an explicit manual-pin exception when GPS is absent.
- Verified YOLO26l-sem checkpoint and compatible Kaggle inference contract.
- Defensible severity denominator/calibration; highest raw pixel count is not
  automatically the most severe image when resolutions or crop coverage differ.
- Compact public/admin layouts, simple expert accept/reject flow, question-mark
  disclosure, yellow BLB/red Brown Spot legends, original-image toggle and hover.

Keep existing specialist publishing gates intact until the later provisional
publication design is implemented and tested explicitly. Never forge approval.
