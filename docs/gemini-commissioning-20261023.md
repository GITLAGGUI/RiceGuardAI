# Gemini commissioning: observed state

23 October 2026. This is a partial commissioning receipt, not an automation signoff.

## Browser access

Chrome browser 3 reconnected without changing any browser permissions. The
existing RiceGuardAI custom app was reused. No second connector or broader
survey grant was registered.

## Private image boundary

The initial live image request failed with `unsafe_evidence_media`. The deployed
`RG_GEMINI_MEDIA_HOSTS` setting was absent. The exact controller-compatible host
was verified against the real controller source and boto3 presigning behavior:
`riceguard-l40s-78407276-20260824.s3.amazonaws.com`.

Configured only that exact host; no wildcard, public bucket permission, redirect
exception, credential disclosure, or grant change. All eight actual local JPEG
derivatives passed `qa/verify_live_visual_bytes.ts` using the same strict
`readVerifiedImage` implementation, hashes, dimensions and byte counts.

The normal Gemini Chat then fetched all four batches. Live SQL confirmed eight
grant/catalogue-scoped delivery receipts. This proves validated bytes were served,
not that Gemini visually inspected them. Gemini explicitly reported no visual
content in its context and initially retained only the final text label per batch.

A minimal response change now places complete labels/pagination in one JSON text
block followed by the two standard MCP image blocks. The regression test failed
before the change and passed afterward. Full Deno suite: 68 passed, 0 failed,
including the local PostgreSQL bridge. An earlier command lacked `--allow-run=node`
and had 67 passes/1 permission failure; it is not counted as a passing run.

The isolated candidate contains 19 source/config/lock files and only `server.ts`
differs from released v4. First candidate deployment failed to bundle because
`advisoryEvidence.ts` was missing; no successful release was claimed. The v2
candidate includes that unchanged dependency and passed standalone Deno check.
Only `advisory-mcp` was then successfully deployed. No Vercel/worker/model change.

The actual post-release Gemini call at offset 0 returned both labels and
`next_offset: 2`, but Gemini still reported zero visible images. Metadata
compatibility is fixed; actual visual analysis remains unverified and currently
contradicted by the live response. Do not submit a supposedly image-reviewed
advisory based only on these delivery receipts.

## Task mode and platform constraint

The initial Task-mode call failed before evidence retrieval with
`Transport for env PROD not found in configuration`. Normal Chat evidence and
image transport work, making this a distinct Task-path failure. One bounded
read-only Task retry finished with the same transport error, even for the small
`advisory_queue_summary` action. No write or schedule change was attempted.

Google's official custom-app documentation, inspected today, explicitly requires
manual confirmation for custom-app write actions:
https://support.google.com/gemini/answer/17209137?hl=en-12

Therefore fully unattended custom-MCP `submit_advisory` is not established and
must not be promised or implemented by disguising writes as read-only tools.
The Gmail monitor exists and is waiting, but notification sending remains off.
No new email, private advisory, bulletin publication, or SMS was sent by these
commissioning tests. No new API key/provider was introduced.

Post-release smoke: `advisory-mcp` version 8 is ACTIVE with its own OAuth boundary
and gateway JWT disabled as intended; resource discovery 200 and anonymous MCP
POST 401. Saved and visually inspected proof:
`output/gemini-image-metadata-only.png`.

## Narrow contact protection: live

Applied `20261023060238_legacy_contact_rpc_access.sql` atomically with history.
The original contact queries were moved into `private` with the same OIDs and
unchanged bodies, and public wrappers require an active admin or trusted backend.

Local PGlite: 11 checks passed for anonymous/ordinary/admin/inactive/backend paths
and unchanged public location access. Live checks confirm:

- anonymous contact RPC execution denied;
- authenticated direct private-helper execution denied;
- actual ordinary authenticated call raises 42501, Active administrator required;
- original query-body hashes unchanged;
- `find_nearby_detections` body unchanged;
- anonymous public-location projection access retained;
- all seven published bulletin rows retained.

No farmer, farm, detection, or bulletin records were changed. The local ACL fixture
does not prove all live PostGIS/business query paths; these queries were preserved,
not rewritten. Public disease locations deliberately remain public.

## Goal still incomplete

Actual Task/image analysis/private write/new-event commissioning remain blocked
or unverified. Provisional publishing/SMS, future survey-consent design, YOLO26l-sem
promotion, calibrated severity, reverse-geocoded location names, review/overlay
and public-layout requirements still need their own implementation and proof.
