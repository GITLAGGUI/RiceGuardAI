# Gemini visual automation implementation plan

Date: 23 October 2026, Philippines
Design: ../specs/2026-10-23-gemini-visual-automation-design.md
Execution: continue in this chat, with two narrowly scoped implementation agents.
No deployment, real emails, public posts or SMS in local implementation checks.

## 1. Preserve baseline and reproduce

- Keep the existing isolated worktree; do not overwrite the dirty original repo.
- Keep the 34-test baseline and local artifact-hash fix from diagnosis.
- Confirm real source contracts, not the legacy runner's different output format.
- Never change historical result manifests to make a connector read succeed.

## 2. Safe derivatives

Files: workers/advisory_media/derivatives.py and test_derivatives.py.

- Implement verified-source, metadata-free RGB JPEG overviews and bounded crops.
- At most 768 KiB each; record the real dimensions, quality and source hash.
- Do not overwrite source or output and do not follow caller-controlled symlinks.
- Test with synthetic images first; verify unchanged source hashes and metadata.

## 3. Private catalogue persistence

Files: CLI-created 20261023010946_gemini_visual_media.sql and
frontend/qa/gemini-visual-database.mjs.

- Add a private immutable revision-bound sidecar, not columns on public results.
- Validate all original+combined pairs, exact source hashes, limits and paths.
- Read through a service-only RPC after rechecking grant and current evidence.
- Test RLS/ACL, idempotency, conflicting/stale revisions and 1/4/10-photo fixtures.
- Storage checksum verification by the trusted completion service precedes save.

## 4. MCP catalogue and image batches

Files: connector contracts/store, new visualMedia.ts, media.ts, server.ts, tests.

- Add a separately enabled read-only get_advisory_image_batch tool. Off by default
  until the private SQL and derivative preparation are deployed and verified.
- Keep existing four-tool compatibility while the visual feature flag is off.
- Catalogue binds all photos and variants to exact immutable evidence. Images
  contain their source ID, index, variant and hash, never private paths/URLs.
- Read two images per batch, with explicit expected/served/missing accounting.
- Error on missing media; no silent visual-to-text fallback in this new tool.
- Record server-side delivery audit, scoped to the grant/catalogue, before a later
  visual submission can claim all required images were delivered. This proves
  delivery, not LLM attention or correct interpretation.
- Test paging beyond two images, byte/hash mismatch, stale digests, no permission,
  partial catalogue and revoked grants. Preserve legacy private write behavior.

## 5. Trusted preparation and pin integration

- Use existing signed-pinned-uploads, verify-pinned-artifacts and
  signed-pinned-review routes with derivative paths inside the authorized run's
  outputs prefix. No new public object-store access or arbitrary fetch proxy.
- New worker output uses a separate derivative sidecar with unchanged native
  result manifest. Save sidecar only after object-store checksum verification.
- Update packaging/code hashes and workflow pins together, retaining explicitly
  supported completed revisions. Never promote an unverified model checkpoint.
- One authorized existing-fixture backfill is separate from historical scanning.
- Test upload checksums, callback replay and independent failure of the optional
  advisory preparation without falsely marking successful inference as failed.

## 6. Event outbox and Gemini Task

- Emit an idempotent event only after result and derivatives are ready.
- Approved inbox receives a fixed event notification, no personal evidence.
- Add a narrow event lookup to verify email signals against the authenticated
  queue and exact revision; email body is not executable instructions.
- Configure a Gemini Gmail-monitor Task only after recipient/sender and real
  account support are confirmed. Preserve platform approvals and privacy choices.
- Verify one new processing event without a manually typed advisory prompt.
- Surface waiting_for_confirmation, expired access and failed-source checks.

## 7. Advisory and later public delivery

- Keep farmer body concise and action-focused; store provenance separately.
- Show the accessible ? badge; no fake specialist verification or raw-pixel
  severity. Standing water is not automatically flooding.
- Test private visual saving first. Implement provisional publishing and corrected
  states separately, without bypassing or forging existing human-review records.
- Publish/SMS only in specifically approved live trials with exact receipts and
  eligible consenting recipients. No live communication during local tests.

## Verification and handoff

Run Python synthetic tests, Deno type/tests, local PostgreSQL integration, targeted
frontend checks as changed, then an independent scoped code review. Refresh local
code maps at checkpoints. Track original, staged and deployed artifact hashes.
Request the exact new release authorization before production mutation. Report
local checks separately from actual Gemini image delivery, automatic trigger,
public publication and handset delivery. Update HANDOFF.md at every meaningful
checkpoint; never call this complete on the basis of a generated Gemini answer.
