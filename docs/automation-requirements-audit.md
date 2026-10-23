# RiceGuardAI automation: requirement audit

23 October 2026, Asia/Manila. Goal remains the complete automatic upload-to-advisory
and provisional publication/SMS workflow, with optional specialist review. A green
unit test or deployed relay does not satisfy the full goal.

| Requirement | Evidence now | Status / next gate |
| --- | --- | --- |
| Event-only owner notification | Deployed Apps Script v1, invalid signature denied, one signed test accepted and exact Gmail INBOX message read | Verified live transport; synthetic event only |
| All original/overlay photos reach Gemini | Local derivative builder, catalogue/source hashes, two-view pagination and delivery checks | Local implementation only; real visual roundtrip outstanding |
| Successful inference preserves its native result | Worker tests isolate optional preparation failures; source hashes preserved | Local tests only; new packaged worker not released |
| Compatible packaged worker deployment | New local migration 20261023051943,24 executable SQL checks passed, current live dispatch pin inspected | Needs final review and coordinated release;0 live active pinned jobs at audit |
| Ready event after verified derivatives | Private outbox/lease SQL and completion hook,89 local DB checks | Live visual/event tables absent; not commissioned |
| Automatic Gemini Task after each eligible event | Existing custom-app read roundtrip previously user-observed | Gmail monitor not created; actual account/model/confirmation behavior unverified |
| Image-grounded practical advisory and source support | Action-focused tool instructions; exact revision/digest, research and limitations contracts | No real visual private write yet; source correctness still requires live content evaluation |
| Existing and future survey consent | One active image grant, expiry22Nov2026, selected-survey scope preserved | New survey enrollment not automatic; explicit future-intake consent design required |
| Provisional public bulletin, accessible question badge | Approved overall requirement | Not implemented/released in this visual phase; must not fake human review |
| Automatic SMS and correction/retraction | Existing consenting-recipient/location rules preserved | Provisional publishing/SMS integration and controlled real trial outstanding |
| Automated severity math | Current masks mean different things and have no calibrated lesion denominator | No validated automatic disease-severity method; do not label raw pixels as severity |
| BLB YOLO26l-sem | Existing pinned model hashes unchanged | Requested replacement checkpoint still needs identity/compatibility validation and promotion |
| Overlay colors, legend, original toggle, hover focus, layout | User's original requirements remain | Must inspect actual frontend and validate each before completion; not established by relay tests |
| Coordinates to barangay/city/province | Current GPS/manual pins exist; only province geometries, names table has no barangay geometry | New addition; proposed local boundary lookup awaiting approach choice, not implemented |

The new location request applies to EXIF-derived and manually chosen coordinates
and to later pin corrections. Suggested label format: Barangay, municipality/city,
province. Preserve private coordinates; a place label does not grant permission
to publish an exact farm pin. A stale lookup must not overwrite a newer pin or a
manual correction. Missing/ambiguous/outdated boundaries need an honest fallback.

## Latest local verification

- Full default frontend test run:196 tests passed but4 UI workers failed to start
  (fork initialization timeout). This was NOT accepted as a green run.
- Full sequential re-run, `vitest run --maxWorkers=1 --no-file-parallelism`:
  all31 files /248 tests passed, exit0,144.07seconds. The same four UI files ran.
- `npm run build`: TypeScript and Vite passed,6330modules; warning remains for the
  existing RiceField3D chunk larger than500KiB. Not proof of mobile performance.
- All three changed/dependent Edge entrypoints typechecked; relay126 mocked
  checks passed. Full connector suite56 had passed in the prior verification.
- Packaged11Python sources were rehashed: exact match with the new TS workflow
  pin. No pip/model/GPU run was needed for this check.
- Private relay key Windows ACL was checked and restricted to the owner, SYSTEM
  and Administrators, protected against inherited broader read permissions.

A live roll-out must first verify an authorized fixture, then one genuinely new
eligible processing event. Preserve any platform confirmation gate and measure
actual latency rather than promising immediate execution.

## Intake and release validation follow-up

Parent reviewed the intake change against the actual downloaded live v59, not
against the much older Git base. Required data reads now reject an unexpected
null result before dereferencing it. Optional reads and successful write receipts
still permit null. Five helper tests cover null, undefined, database errors,
empty lists and valid falsy values. Review paths have an explicit string guard.
Existing authentication, public bulletin and SMS decisions are unchanged.

Fresh full Deno run:67 passed,0 failed, including local PostgreSQL integration.
Source intake standalone typecheck passed. Candidate v4 has183 verified source
hashes,11 exact worker ZIP entries and matching TypeScript/SQL workflow pins.
The release must include field-operations as well as dispatcher/callback: its
intake manifest embeds the active pin. Its existing gateway JWT check stays on.
v3 frontend build passed; v4 frontend bytes are identical. v4 final intake
typecheck and full frontend regression are still being collected at this entry.

User clarified that published disease locations are intentionally PUBLIC for
farmers. Do not use contact-data hardening to hide published map/bulletin
locations. Legacy contact-returning RPCs need separate guards; no such migration
has been applied, and no actual personal rows were retrieved during the audit.
The empty CLI-created legacy access migration is excluded from this candidate.

Still not proof: live Gemini image receipt, unattended Gmail Task, actual private
visual submission, automatic provisional publishing/SMS, checkpoint promotion,
scientific severity calibration and coordinate-to-barangay implementation.

## Approved live rollout, 23 October 2026

User approved the scoped release conditional on checks. Fresh full frontend
rerun passed31files/248tests in171.65seconds; full Deno67passed. Isolated review
database10tests passed; the earlier full run was cancelled after setup timeout
and was not counted as passing. Candidate v4 intake standalone check passed.

Applied exactly five Gemini migrations in one transaction, with history entries;
deployed advisory-mcp,worker-callback,advisory-notifier,field-operations and
job-dispatcher. Verified live new dispatch pin, one notice cron and empty visual
catalogue/event/submission tables. Unauthenticated requests to the four operational
endpoints return401; MCP resource metadata returns200. No new grant or real event.

New Vercel deployment dpl_5KS3Xfkj6BotiV1FWvA79BdpW93v is still BUILDING at
the last observation; created with skip-domain. Do not treat command text saying
ready as authoritative: inspect actual readyState. Upload/dispatch flags are
temporarily false until the package is ready, promoted and smoke-checked.
Image/event/notice feature activation and actual visual roundtrip remain pending.

Rollout finalized: the same deployment is READY and promoted to riceguardai.dev;
homepage200/root present, unsigned inference API401, resource discovery200.
Upload and dispatch flags restored true, verified by private digest comparison.
Thus maintenance is over. The full advisory system is still not commissioned.
Fresh fixture read confirms revision1 and one active image grant. Chrome session
currently unavailable to CUA (only empty in-app browser exposed); user reconnect
request sent. No duplicate connector, new test email or advisory submission made.
