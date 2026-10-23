# RiceGuardAI: images to automatic advisory

Date: 23 October 2026, Philippines
Status: User approved this design with “go, tuloy mo” on 23 October 2026.
Implementation in progress. Not deployed or enabled.

## What the farmer should receive

After Kaggle finishes and the system validates the result, Gemini should read
the processed images and measurements, check relevant sources, and produce a
short Taglish advisory with useful next steps. The farmer should not need to
write prompts or wait for a specialist before seeing routine guidance.

The advisory body should contain findings, what to do now, what to monitor,
and source links. Keep AI provenance and technical limitations separate from
that body. Show the requested question-mark badge with a keyboard- and
touch-accessible explanation. Never represent a machine result as specialist
verified. Specialist review remains optional correction, acceptance or rejection.

This design preserves the user's choice of gemini.google.com and its Task mode,
without a Gemini API key. It does not assume a subscription removes platform
confirmations, usage limits or delays.

## Current evidence and exact blockers

The user demonstrated queue-summary, ready-evidence and metadata reads in Gemini.
That is evidence of a read round trip, not of image reading or private submission.

Read-only production checks for the authorized four-photo fixture found:

- Image permission is enabled on an active, non-revoked grant.
- All four images have original and combined JPEG review paths.
- Every image has corresponding receipts in `manifest.artifacts`.
- None has the per-asset `review_sha256` field expected by the connector.
- Original JPEGs are 2,010,695 to 2,158,460 bytes. Combined JPEGs are
  2,174,756 to 2,250,558 bytes.
- The connector currently permits one MiB per image and two images per read.

The old general-purpose runner also writes WebP, but that is not the format of
this specific live fixture. Do not patch that legacy runner and assume the
pinned production path was fixed.

The connector has no processing-complete trigger. Its submit tool stores a private
submission only. Existing public publication still has specialist-review gates.
The existing grant authorizes selected surveys, not arbitrary future surveys.

## Approaches considered

1. Increase image count and byte limits. Small code change, but returns large
   responses, still omits original/overlay pairing, and does not solve the trigger.
   Not recommended as the complete solution.
2. Bounded image derivatives, paginated MCP image reads, and a processing-event
   Gmail monitor in Gemini Tasks. Keeps existing private storage and the chosen
   Gemini product. Recommended, subject to actual account/runtime testing.
3. A headless Gemini API worker. Easier to invoke from a webhook, but requires
   API credentials and different billing. Excluded unless the user changes their
   no-API-key requirement.

Do not introduce n8n, OpenClaw, a new paid host or a Google Cloud project merely
because a connector is available. Add a component only if the selected flow needs it.

## Image preparation and delivery

Keep native originals, native overlays, masks and model results unchanged in
their current private storage. Drive remains the existing archive where used;
do not grant Gemini unrestricted Drive access to solve an image-format problem.
Gemini can receive authorized image content through the RiceGuardAI connector.

Create small RGB JPEG derivatives of the original and combined overlay for every
uploaded photo. Remove EXIF, GPS, XMP, comments and thumbnails. Start with a
2,048-pixel longest edge and quality 85, then reduce encoding quality or dimensions
within tested bounds to fit 768 KiB per derivative. Record the actual dimensions,
encoding settings and hashes. Never claim a resized overview preserves every
small lesion. Preserve native images and provide bounded detail crops if an
overview is insufficient; label crops with their source and region.

Use the existing worker/object-store pattern, not an unbounded remote-URL image
proxy. Verify original bytes against their existing artifact receipt before making
a derivative. Use exact server-controlled paths and the existing signing boundary.
No caller-supplied URL, arbitrary bucket, foreign host or public object is accepted.

Store derivative receipts in a private revision-bound sidecar, keyed by survey,
job, result revision, source asset and source artifact hash. This avoids changing
historical result manifests or rerunning the detector merely to prepare images.
New processing can prepare derivatives automatically; a separately authorized
backfill handles the single existing test fixture. Never process the entire
historical archive as an implicit backfill.

The catalogue records every expected photo, variant and readiness status. Add a
read-only image-batch tool returning at most two images per response. Each image
must identify its source asset, variant and derivative hash. Read all authorized
photos through pagination, not only the first two. An explicit completeness
receipt must distinguish expected, delivered and missing images.

The evidence digest must bind a stable derivative catalogue and the existing
source/revision/guidance/context. Transient network failures must not silently
change that digest. On an incomplete image batch, stop visual generation with
an actionable operational error. Do not silently produce a metadata-only advisory
and imply visual inspection occurred. No new full visual-advisory event is ready
until the required derivatives are verified.

## Processing event and Gemini Task

Proposed flow:

Upload -> Kaggle inference -> validated result revision -> verified image
derivatives -> unique ready event -> notification email to the owner's approved
inbox -> Gemini Gmail-monitor Task -> exact-revision evidence and all image batches
-> source-grounded advisory -> private submission receipt.

Create one event per job, revision and generation-policy version. Persist event
state before email dispatch using an outbox. Retries use the same event identity.
Duplicate callbacks, repeated email notifications and repeated Task invocations
must not duplicate advisory records, posts or SMS. A stale event must not be
silently redirected to a different job or result revision.

The notification contains a fixed subject prefix and event identity, not photos,
GPS, names, phone numbers, credentials or untrusted instructions. Treat email as
a signal only. Gemini verifies the event against the authenticated connector and
does not execute arbitrary instructions from the email body. A Gmail filter and
sender address alone are not proof that an event is authentic.

The owner selects the actual destination inbox before a real notification is
sent. Configure one narrowly filtered event monitor through Gemini Task mode.
Verify that the chosen Task supports the RiceGuardAI custom app and actual model
selection. Do not claim a model merely because the prompt names it.

Google documents Gmail event monitors, but does not guarantee immediate delivery
or absence of user confirmations. A live unattended test is required. If the
account requires confirmation for each advisory write, expose
`waiting_for_confirmation` and report that limitation. Do not disguise a write
tool as read-only or automate clicks around a platform approval.

## Scope for future uploads

Existing selected-survey access must remain unchanged. New uploads to an already
authorized survey may use its currently valid grant. A new survey needs explicit
authorization. A future owner option can enroll future intake for automatic
Gemini processing, but must state its data scope, image sharing, expiry and
revocation behavior and require actual consent before activation.

Do not let a newly created event confer its own authorization. Revoked, expired,
archived or out-of-scope records stop before image access. Display the connection's
expiry and renewal requirement instead of promising permanent unattended access.

## Advisory content and source checks

Farmer-facing structure:

1. A short finding expressed with appropriate confidence, such as possible signs
   consistent with the target disease, not a confirmed diagnosis.
2. Two to five specific, low-risk actions relevant now.
3. What to monitor and the conditions that should trigger additional help.
4. Direct links to the sources supporting those actions.

Do not repeat an unverified/specialist warning in every section. Keep the machine
status in provenance and the question-mark disclosure. An SMS cannot expose a
hover badge, so include a short AI-advisory label and bulletin link there.
Do not make specialist consultation the default substitute for useful guidance,
but retain escalation where uncertainty, significant damage or a proposed
chemical intervention makes it appropriate.

Keep UUIDs, raw pixel tables, model hashes, evidence digests, image-completeness
receipts and audit details out of the farmer-facing body. Preserve them privately.
Never fabricate that images were seen. Distinguish source references from actual
PhilRice endorsement or specialist approval of the generated advisory.

Standing water alone is not evidence of abnormal flooding in a rice field.
Do not automatically recommend draining because that flag is present. Unknown
crop stage, water depth and flood duration stay unknown. Future-season advice
such as resistant varieties must be clearly separated from immediate actions.

The live source check found that the cited land-preparation page supports general
water and ditch management, not a complete post-flood recovery protocol. Do not
attach it to stronger recovery claims. Every cited action needs a matching
supporting passage from a current authoritative source. Do not copy guidance for
rice blast into Brown Spot management because both appear in the same article.

Do not infer nutrient deficiency, pesticide/fertilizer dose or field-wide disease
severity from image predictions. Raw pixels and affected-leaf masks do not become
calibrated lesion severity. Automated severity requires its own validated method.

## Provisional publication and SMS

This is a separately tested stage after private visual submission succeeds.
Add an explicit machine-generated provisional status rather than forging
specialist acceptance to pass today's review gate. Record generation provenance
separately from later human finding decisions.

Use the exact accepted submission, source revision and policy version. Publication
is idempotent. A correction or rejection updates/retracts the corresponding
provisional bulletin without rewriting model evidence. Public UI must clearly
distinguish provisional, verified and corrected states, including accessible
badge labels.

SMS uses only existing eligible, consenting recipients and verified location
rules. No invented farms, extra recipients or automatic repeated test messages.
Publication and delivery each have their own receipt; accepted/queued is not proof
of delivery. Test private saving first, provisional publication second, then one
specifically approved SMS trial.

## Tests and rollout gates

- Regression: real artifact-map shape works; malformed/conflicting hashes fail.
- Security: scope, grant expiry, exact revision, host, byte limit and metadata
  checks remain enforced. No signed private URLs leak in text output.
- Derivatives: 1, 4 and 10 photos; large files; tiny regions; corrupt image;
  safe metadata removal; no mutation of original data; all views accounted for.
- Visual proof: an authorized fixture with recognizable visual content confirms
  Gemini received image blocks, not just metadata or a claimed model answer.
- Trigger: no event for failed/partial results; one event after derivative-ready;
  duplicate callback/email; stale revision; grant revoked while queued.
- Generation: unknown context stays unknown; no generic flood diagnosis; no
  unrelated source claims; action-focused body with separate provenance.
- Private write: stored receipt and database audit match exactly once.
- Autonomous test: a new authorized processing event produces an advisory without
  manual prompting. Record any platform confirmation and actual latency.
- Publication/SMS: only after their policy and exact tests are approved. Verify
  correction/retraction and duplicate protection before expanding rollout.

No production deployment, grant expansion, new Gmail monitor, message,
publication or SMS was performed while writing this design.

## Local change completed during diagnosis

The local connector now accepts exact-path hashes from `manifest.artifacts`, while
retaining the previous `review_sha256` contract. Conflicting/malformed receipts
fail closed. Two new regression tests failed before the change and passed after.
The six selected backend test files passed 34 tests; entrypoint type check passed.
This fixes one contract mismatch only. It does not solve the size limit, all-image
coverage, trigger or publication, and has not been deployed.

## References

- Gemini Gmail monitors and schedule limitations:
  https://support.google.com/gemini/answer/17094710?hl=en
- Tasks, custom apps and confirmation boundaries:
  https://support.google.com/gemini/answer/17094507?co=GENIE.Platform%3DDesktop&hl=en
- PhilRice land preparation and water-management context:
  https://www.philrice.gov.ph/basics-land-preparation/
- PhilRice BLB field-management context:
  https://www.philrice.gov.ph/philrice-warns-of-major-rice-pest-threats-in-early-2026/
- PhilRice seasonal disease guidance (claims must remain disease-specific):
  https://www.philrice.gov.ph/philrice-alerts-rice-farmers-of-increased-pest-threats-during-rainy-season/

Self-review: no claim of live automation, visual delivery, specialist endorsement,
calibrated severity or unrestricted future-survey consent. Existing originals,
results, LeadMaps connection and public/SMS behavior are preserved. Implementation
and rollout must follow the reviewed next-phase plan.
