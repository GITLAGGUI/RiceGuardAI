# RiceGuardAI Gemini connection setup

Date: 23 October 2026
Status: Written setup design approved by the user on 23 October 2026.
Implementation-plan review, deployment authorization and actual connection consent
remain separate steps.

## Goal

Connect a separate **RiceGuardAI Advisory** custom app to the user's Gemini Apps
account at gemini.google.com. Use the account's **4 Argon** Task option without a
Gemini API key. The user performs connection-consent and Gemini write-action
confirmations when prompted. Never describe these confirmations as removed.

This is the first, separately testable part of the larger automation redesign.
It must not change LeadMaps or enable public publication or SMS during setup.

## What has been verified

- Gemini displays Pro, the custom-app creation form, and a 4 Argon Task choice.
- LeadMaps Contact Inbox is connected with two read-only actions. Its code uses
  its own OAuth/PKCE authorization server and scoped, revocable credentials.
- The current RiceGuardAI source has Supabase-backed operational APIs and
  advisory validation, but no custom MCP server was found in the scoped source
  search. A Gemini connection cannot be completed by entering a nonexistent URL.
- The existing publication path requires reviewed findings and exact-revision
  publication. This connector must not forge reviews to satisfy that path.
- The repository is substantially dirty. Existing user edits remain untouched.

These observations are not proof of a new RiceGuardAI connection or a successful
Argon advisory round trip. Those are acceptance tests, not completed work.

## Chosen approach and alternatives

Use a RiceGuardAI-owned HTTPS MCP endpoint and a separate, minimal OAuth grant.
Adapt the verified LeadMaps authorization pattern to RiceGuardAI's own admin
identity and database, with current protocol validation and tests. Do not copy
LeadMaps credentials, tokens, user identifiers, database connections or inbox tools.

Do not reuse the LeadMaps connector: it has the wrong data boundary and no write
action. Do not create a Google Cloud project merely to host MCP authorization.
Do not silently switch to Gemini API, Workspace Studio, OpenClaw or browser-session
scraping. None is the product the user selected.

## Hosting and routes

Reuse the existing website and Supabase hosting. The proposed public resource is
`https://riceguardai.dev/api/advisory-mcp`. This URL is a design target, not a live
server claim. Add explicit routes before the SPA catch-all so MCP/discovery calls
cannot receive index.html as a false success.

The backend must expose standard protected-resource and authorization-server
metadata, authorize/token/revoke endpoints, and a RiceGuardAI consent page. The
consent page uses existing admin authentication plus server-verified AAL2/MFA and
an explicitly configured connector-owner identity. Ordinary staff and subscribers
cannot grant this connection merely because they are authenticated.

Implement the MCP handler and grant storage against the existing Supabase backend;
the website forwards only the exact connector routes. Keep privileged database
credentials server-side. No new paid cloud resource or billing upgrade is needed
for this design; existing hosting usage still follows provider quotas.

## Minimal tools

| Tool | Effect | Data and limits |
|---|---|---|
| `advisory_queue_summary` | Read | Counts of ready/awaiting/returned jobs and latest update only |
| `list_ready_evidence` | Read | At most 20 eligible revision IDs per page; no original media URLs or contact data |
| `get_advisory_evidence` | Read | Exact authorized revision, validated findings, known/unknown context, mask meaning, approved source guidance and sanitized evidence only |
| `submit_advisory` | Write | Store a validated, revision-bound advisory submission privately; no publication or SMS in setup mode |

The write tool must be honestly annotated as a write. It may not be disguised as
a read or as a status check to avoid Gemini's confirmation. The tool description
states exactly what it stores and that it does not verify findings as a specialist.

Only surveys explicitly enabled for this connection are accessible. Start with
an isolated non-public fixture, not all historical surveys. Missing/expired grant,
wrong revision, revoked permission, or out-of-scope survey denies the request.

## Evidence and advisory contract

The evidence response contains schema version, job ID, survey ID, immutable result
revision, evidence digest, real model identifiers/hashes, per-image BLB/Brown Spot
findings, explicit limitations, existing approved source IDs, and approximate
region context. Do not export phone numbers, subscriber records, exact GPS,
addresses, service credentials, private bucket paths or broad Drive access.

Current BLB disease-region coverage and Brown Spot affected-leaf coverage must keep
their different meanings. Neither becomes calibrated lesion severity or confirmed
diagnosis in the prompt. Unknown values stay unknown; zero detections do not mean
healthy. Do not label machine evidence as human-reviewed.

Image access is a separate, explicit permission in the consent page. If enabled,
return only bounded EXIF-free evidence derivatives through authorized access, with
no people/contact/location identifiers. Test whether Gemini actually receives and
reads the images. Text-only tool success does not prove visual inspection. If the
client cannot read images, record that limitation and do not claim visual reasoning.

An advisory submission contains the exact job/revision and evidence digest, an
idempotency key, natural Taglish summary, practical actions, limitations, source
IDs, and research citations with title/URL, supporting claim, and retrieval time.
Store generation provenance separately from specialist verification. A model name
typed by the LLM is self-reported; only the configured Task selection is verified.

Use the existing advisory schema and approved guidance library for safe actions.
Web research may add context, but a supplied URL is not proof that the claim is
supported. Do not automatically promote arbitrary websites into trusted guidance.
Any source-fetching code must be bounded and prevent SSRF/private-network access.
No unsupported pesticide dose, treatment guarantee, yield claim or disease cause.

Reject mismatched/stale revisions, invented approved source IDs, missing sources,
malformed submissions, and conflicting idempotency keys. Repeating an identical
accepted submission returns its existing record instead of duplicating work.

## Authorization boundary

- Separate permissions: `evidence:read` and `advisory:submit`.
- Never accept an ordinary Supabase admin token as a Gemini connector token, or
  accept a connector token at unrelated admin endpoints.
- Resource-bound OAuth authorization code flow with S256 PKCE, exact registered
  redirect URI, state validation, short-lived one-use codes, short-lived access
  tokens and rotating refresh tokens. No wildcard redirects or URL tokens.
- At most a 30-day grant, visible expiry and immediate owner revocation. Validate
  active owner role, grant, scope and survey permission on every tool request.
- Current MCP client-registration preference follows supported standard metadata;
  use pre-registration if Gemini's actual manual form needs it. Dynamic client
  registration is a compatibility option, not a reason to open unrestricted client
  registration. Capture the actual Google callback privately during setup.
- RLS/private table permissions protect grant/token/submission records. Store token
  hashes, not reusable plaintext. No privileged keys in browser code or reports.
- Audit grant ID, action, revision, outcome and time without logging credentials,
  private images or full farmer information.
- No tools for contacts, arbitrary SQL/HTTP, deleting files, SMS, deployment,
  accepting/rejecting findings, specialist verification, or direct publishing.

## Setup and user confirmation sequence

1. Review this written design, then prepare/review the implementation plan.
2. Implement locally, verify negative/security tests and a private round trip.
3. Present the exact deployment diff and obtain deployment authorization. Deploy
   only the tested connector, required discovery routes, private schema and consent UI.
4. Verify live discovery, anonymous denial and correct routing before entering the
   real HTTPS URL in Gemini. Stop rather than accepting SPA HTML or a broken server.
5. At the real consent screen, explain the app name, scopes, specific evidence,
   Gemini destination and 30-day duration. Tell the user to confirm only if the
   displayed permissions match. Do not click Allow for the user.
6. Verify that Gemini lists the four intended tools and no unexpected action.
7. Select 4 Argon and run one authorized isolated-fixture read test, then one
   private advisory submission. Tell the user when Gemini requests write approval.
8. Match Gemini's result against the stored revision, submission and audit event.
   A generated answer alone is not evidence of a successful write.

Do not send a real Gmail event, create a recurring task, expose private farm photos,
publish or send SMS as part of the fixture trial without their specific approvals.

## Acceptance checks

- Metadata/HTTPS routing correct; unauthenticated calls denied.
- Non-owner, missing MFA, wrong scope/audience, foreign redirect, replayed code,
  expired/reused refresh token and revoked grant rejected.
- No access to LeadMaps, contacts, exact locations or arbitrary surveys.
- Allowed tools and schemas match the consent screen and Gemini tool list.
- Untrusted image text, notes and source text never become tool instructions.
- Exact private-fixture read and revision-bound advisory write observable in DB.
- Duplicate submission safe; stale/conflicting payload refused.
- Existing website, admin authentication and reviewed publication remain working.
- Public posts and SMS counts unchanged throughout setup.
- Record whether an image was actually readable and whether Gemini required a
  write confirmation. Report these honestly, not as complete unattended automation.

## Relationship to the user's final workflow

The agreed end state remains automated provisional publication followed by optional
specialist verification. Gemini's platform confirmation is not specialist approval.
This setup isolates the connector trial from that later publication-policy change.

Gmail event triggering after validated inference, Drive evidence output, automatic
provisional publication/SMS, large BLB model promotion, severity work and public UI
redesign remain separate implementation phases. No existing review checks are
weakened merely to make this connection test pass. If Gemini asks for a confirmation
for every submission, document that human dependency; do not call the entire path
unattended or bypass Google's control.

## References and source anchors

- Current MCP authorization: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- Gemini custom apps: https://support.google.com/gemini/answer/17209137
- Gemini Task schedules: https://support.google.com/gemini/answer/17094710
- Existing source: `supabase/functions/_shared/advisoryEvidence.ts`,
  `supabase/functions/generate-advisory/index.ts`,
  `supabase/functions/field-operations/index.ts`, `vercel.json`.
- Reusable pattern, not a dependency: LeadMaps `src/server/contact-mcp.ts` and
  `src/server/contact-oauth.ts`. Preserve the existing read-only LeadMaps grant.

Self-review: scope limited to connection/private trial; no invented live endpoint,
no implicit publication, no fabricated scientific calibration, no promise that Pro
removes confirmations. Written-spec approval is recorded above; implementation-plan
review and execution-method selection remain required before product implementation.
