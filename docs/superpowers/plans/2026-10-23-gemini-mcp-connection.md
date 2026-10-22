# RiceGuardAI Gemini Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Gemini Apps 4 Argon to a separate, consented RiceGuardAI evidence reader and private advisory submission tool, without a Gemini API key.

**Architecture:** One authenticated Supabase Edge Function serves the MCP resource and OAuth endpoints through explicit website rewrites. A private Postgres schema stores restricted grants, selected-survey permissions and submissions. The existing React admin supplies owner/MFA consent; publication and SMS remain unchanged.

**Tech Stack:** Existing React 19/Vite/Vitest/PGlite; Supabase Edge Functions and Postgres; MCP SDK 1.32.1, Zod 4.6.7, existing Supabase JS 2.57.4. Use Deno 2.9.6 through the official npm package for backend checks; no global runtime installation required. These package versions were read from the official npm registry, not installed or tested in this planning turn.

**Spec:** `docs/superpowers/specs/2026-10-23-gemini-mcp-connection-design.md` (user approved 23 October 2026).

## Global Constraints

- "It must not change LeadMaps or enable public publication or SMS during setup."
- "Separate permissions: `evidence:read` and `advisory:submit`."
- "At most a 30-day grant, visible expiry and immediate owner revocation."
- "Only surveys explicitly enabled for this connection are accessible."
- "At most 20 eligible revision IDs per page" for `list_ready_evidence`.
- "The write tool must be honestly annotated as a write."
- "Never describe these confirmations as removed."
- "Do not label machine evidence as human-reviewed."
- "No tools for contacts, arbitrary SQL/HTTP, deleting files, SMS, deployment, accepting/rejecting findings, specialist verification, or direct publishing."
- Preserve the dirty checkout. Stage/commit only task-owned hunks and files; never bulk-add or deploy the current whole working tree. Keep credentials out of reports, prompts, source and test output.
- No project creation, public DNS change, new cloud service, model promotion, recurring monitor or Gmail send in this plan.

## Review Focus

1. Simultaneous code/refresh/submission retries: exactly one state transition, no duplicate advisory (Tasks 2, 3, 5).
2. Owner deactivation or survey revocation between requests: next read/write denied, even with an unexpired token (Tasks 2, 4, 7).
3. Real OAuth navigation without an Authorization header: show login/MFA, preserve a pending request, never issue a grant from GET alone (Tasks 3, 6).
4. Private pictures, EXIF, filenames or malicious notes hidden in a valid result: whitelist projection and image permission; no raw private paths (Tasks 4, 7).
5. Gemini returns text but ignores images, fabricates citations or declines a write: record actual capability/failure, never claim visual inspection or a saved submission (Tasks 4, 8).

## File map and boundaries

Create shared backend modules in `supabase/functions/_shared/geminiConnector/`:
`contracts.ts` (schemas/types), `policy.ts` (limits/metadata/owner checks),
`store.ts` (typed database operations), `oauth.ts` (authorization flow),
`evidence.ts` (private-data projection), `advisory.ts` (submission validation),
`media.ts` (bounded permissioned derivatives), `server.ts` (HTTP/MCP routing).

Create `supabase/functions/advisory-mcp/{index.ts,deno.json,deno.lock}` and
`tests/{contracts,oauth,evidence,advisory,server}.test.ts` below that function.
Use Node's built-in assert in Deno tests. Pin imports in deno.json and lock them;
do not import MCP SDK into the browser bundle or add a root Node application.

Create one CLI-named migration and an isolated PGlite harness/test:
`frontend/qa/gemini-connector-database.mjs` and
`frontend/src/operations/geminiConnector.database.test.ts`.
Create the frontend API/client and UI:
`frontend/src/operations/geminiConnector.ts`, `GeminiConnection.tsx`,
`geminiConnector.ui.test.tsx`.
Modify only connector-specific hunks in `frontend/src/app/router.tsx`,
`supabase/config.toml` and `vercel.json`. Do not alter field-operations publishing,
generate-advisory provider flags, SMS functions or workers.

Create `docs/gemini-connector-setup.md` and a credential-free release receipt under
`output/gemini-connector/`. The receipt is generated during verification, not now.

## Shared contracts

Task 1 defines and exports these types; later tasks use exactly these names:

- `ConnectorScope = 'evidence:read' | 'advisory:submit'`.
- `RevisionKey = { survey_id: string; job_id: string; result_revision: number }`.
- `GrantContext = { grant_id: string; owner_id: string; scopes: ConnectorScope[]; allow_images: boolean; expires_at: string }`.
- `EvidencePacket`: schema `riceguard.gemini.evidence.v1`, RevisionKey, evidence_sha256, model provenance, machine findings/coverage meaning, known/unknown context, limitations, approved guidance/source IDs. No arbitrary object spread from database rows.
- `AdvisorySubmission`: RevisionKey, evidence_sha256, idempotency_key, existing AdvisoryDraft fields, `research_citations: {title,url,supporting_claim,retrieved_at}[]`, optional `model_self_reported`.
- `SubmissionReceipt = { submission_id: string; status: 'stored_private'; duplicate: boolean; public_post_created: false; sms_enqueued: false }`.
- `ConnectorStore`: `execute(operation: StoreOperation): Promise<StoreResult>`, where both types are discriminated unions keyed by the operation names defined in Task 2. No generic SQL or table-name argument is accepted.
- `ConnectorDeps = { store: ConnectorStore; verifyAdmin: (jwt: string) => Promise<VerifiedAdmin>; media: EvidenceMediaReader; now: () => Date; randomToken: () => string }`.
- `VerifiedAdmin = { id: string; role: 'admin'; is_active: true; aal: 'aal2' }`; server verification, not a browser assertion.
- `EvidenceMediaReader.read(context: GrantContext, key: RevisionKey): Promise<{mimeType: 'image/jpeg'|'image/png'; data: string; sha256: string}[]>`.

## Task 1: Strict contracts and fail-closed policy

**Files:** contracts.ts, policy.ts, deno.json/lock, tests/contracts.test.ts.
**Interfaces:** Produce the shared contracts, `parseSubmission(raw: unknown): AdvisorySubmission`, `connectorMetadata(origin: string)`, and `assertConnectorOwner(admin: VerifiedAdmin, ownerId: string): void`.

- [ ] Write failing tests with these assertions:
  ```ts
  assert.throws(() => parseSubmission({...valid, result_revision: 0}));
  assert.throws(() => parseSubmission({...valid, evidence_sha256: 'fake'}));
  assert.throws(() => parseSubmission({...valid, unexpected_private_field: 'x'}));
  assert.throws(() => assertConnectorOwner({...admin, aal: 'aal1'} as never, ownerId));
  assert.deepEqual(connectorMetadata(origin).scopes_supported, ['evidence:read','advisory:submit']);
  ```
- [ ] Run `npx --yes deno@2.9.6 test --config supabase/functions/advisory-mcp/deno.json supabase/functions/advisory-mcp/tests/contracts.test.ts`; expect a missing-module/test failure before implementation. Runtime package acquisition must use the official npm registry; stop on integrity failure.
- [ ] Implement schemas: UUID keys, revision >=1, lowercase 64-hex digest, 16..128-character idempotency key. Match existing draft limits: summary <=3000, 1..8 actions <=600 each, <=8 limitations <=600 each. Require 1..20 approved source IDs and <=10 HTTPS citations: title <=200, URL <=2048, supporting_claim <=600 characters. Strict unknown-field rejection. Retrieval timestamps may be at most five minutes ahead of the injected clock.
- [ ] Policy constants: JSON request cap 32768 bytes; page size 1..20; authorization request/code expiry 300 seconds; access expiry 3600 seconds; grant expiry <=30 days. Require HTTPS production origin and configured `RG_GEMINI_CONNECTOR_OWNER_ID`; missing owner disables authorization.
- [ ] Metadata issuer `https://riceguardai.dev`; resource `/api/advisory-mcp`; authorization `/api/advisory-oauth/authorize`, token `/token`, revocation `/revoke`. Support pre-registered clients with PKCE S256 and confidential `client_secret_post`; advertise only implemented capabilities. Do not advertise open DCR or unsupported client-metadata fetching.
- [ ] Rerun contracts test and `npx --yes deno@2.9.6 check --config supabase/functions/advisory-mcp/deno.json supabase/functions/_shared/geminiConnector/contracts.ts`; expect PASS. Commit only this task's new files.

## Task 2: Private, transactional connector persistence

**Files:** one migration generated by `supabase migration new gemini_advisory_connector`; store.ts; PGlite harness and database test.
**Interfaces:** Implement ConnectorStore via service-role-only public RPC `rg_mcp_store(p_operation text,p_input jsonb) returns jsonb`. The allowed StoreOperation union has:
`register_client`, `create_request`, `preview_consent`, `complete_consent`,
`exchange_code`, `rotate_refresh`, `access_context`, `revoke`, `owner_grants`,
`queue_summary`, `list_evidence`, `read_evidence`, `save_submission`, `rate_limit`.
Use typed payload/result mappings in store.ts, not unvalidated free JSON at callers.

Every operation is `{op, input}`; its input/output mapping is fixed here (snake_case
SQL fields, nullable fields explicitly null, no caller-supplied SQL/table names):

| op | Input fields | Result |
|---|---|---|
| register_client | owner_id, client_id, client_name, redirect_uri, secret_hash | client_id, client_name, redirect_uri, scopes |
| create_request | request_id, client_id, redirect_uri, resource, scopes, state, challenge, expires_at | request_id, expires_at |
| preview_consent | request_id, owner_id | app_name, scopes, expires_at, eligible_surveys: {id,label}[] |
| complete_consent | request_id, owner_id, decision ('allow'/'deny'), survey_ids, allow_images, code_hash (null on deny), code_expires_at, grant_expires_at | redirect_uri, state, grant_id (null on deny), allowed |
| exchange_code | client_id, client_secret_hash, code_hash, challenge, redirect_uri, resource, access_hash, refresh_hash, access_expires_at | grant_id, scopes, grant_expires_at |
| rotate_refresh | client_id, client_secret_hash, old_refresh_hash, resource, access_hash, refresh_hash, access_expires_at | grant_id, scopes, grant_expires_at |
| access_context | access_hash, resource | GrantContext |
| revoke | mode ('owner'/'client'), owner_id or client_id/client_secret_hash, grant_id or token_hash | revoked: true (same response for nonexistent token) |
| owner_grants | owner_id | grants: {id,app_name,scopes,allow_images,expires_at,revoked_at,survey_ids}[] |
| queue_summary | grant_id | ready, awaiting, returned, checked_at |
| list_evidence | grant_id, limit (1..20), after ({created_at,id} or null) | revisions: (RevisionKey & {id,created_at})[], next |
| read_evidence | grant_id, survey_id, job_id, result_revision | authorized internal revision/manifest and active guidance rows; never returned raw by MCP |
| save_submission | grant_id, RevisionKey fields, evidence_sha256, idempotency_key, payload_sha256, payload | SubmissionReceipt |
| rate_limit | bucket_hash, window_seconds, max_requests | allowed, retry_after_seconds |

Complete_consent/each access operation rechecks the owner profile. Read/evidence
operations recheck current selected-survey access; save_submission also receives
the validated digest and checks the same revision within its insert transaction.
Use database time for expiry/security transitions; the injected clock is for pure
unit tests and expiry construction, not permission to override database expiry.

- [ ] Write database tests: anon/authenticated cannot execute RPC/read private tables; service-role operation cannot read an out-of-scope/archived/stale survey; two concurrent identical submissions create one row; same idempotency key/different digest conflicts; refresh reuse revokes its grant family; owner deactivation denies the next request.
- [ ] Run `npm --prefix frontend test -- src/operations/geminiConnector.database.test.ts`; expect FAIL before migration/adapter.
- [ ] Create private schema `rg_mcp` with clients, requests, grants, tokens, survey_access, submissions, rate_limits and audit tables. Store hashes of secrets/codes/access/refresh values, never reusable plaintext. Tokens/grants reference their exact resource, client, owner, scopes and expiries. Enforce unique token/code hashes and submission `(grant_id,idempotency_key)`.
- [ ] Use RLS and revoke access from PUBLIC/anon/authenticated. Give service_role only required access. Keep RPC SECURITY INVOKER with a fixed search_path; revoke PUBLIC execute. Do not expose the private schema through the Data API. The existing profiles/result/source tables are read, not modified by this migration.
- [ ] Execute transitions atomically with row locking: one-use request/code; refresh rotation/reuse; consent; revision/digest recheck and submission insert. Match active owner profile and survey permission at access and submission time. An identical retry returns its previous receipt; a stale/conflicting retry fails.
- [ ] Extend the existing isolated QA schema pattern, not its user-owned production release snapshots. Seed a private synthetic fixture and known approved guidance only. Apply the actual generated migration and compare existing public posts, campaigns, outbox and finding-review rows before/after; they must be identical. Keep the exact migration filename in the harness after CLI generation.
- [ ] Rerun the database suite; all tests PASS. Verify denied SQL role grants explicitly, not just mocked store calls. Commit the migration, adapter and fixture/test only.

## Task 3: Owner-approved OAuth and revocation

**Files:** oauth.ts; policy.ts; tests/oauth.test.ts.
**Interfaces:** `handleOAuth(req: Request, deps: ConnectorDeps): Promise<Response>`; `requireGrant(req: Request, scope: ConnectorScope, deps: ConnectorDeps): Promise<GrantContext>`.

- [ ] Write failing tests for exact redirect/resource, PKCE S256, client-secret-post, no Supabase JWT at MCP, expired access, replayed code, refresh reuse, owner mismatch, missing MFA and consent denial. Assert a bare authorize GET returns only a pending-consent redirect, never a code/token or private evidence.
- [ ] Run the OAuth Deno test; expect FAIL. Implement GET authorize validating the pre-registered client, redirect, resource, scope, state and PKCE before storing a five-minute pending request and redirecting to `/admin/connect/gemini?request=<opaque-id>`.
- [ ] Because RiceGuardAI admin auth is browser-held Supabase auth, do not copy LeadMaps' cookie assumption. Owner endpoints `/owner/register-client`, `/owner/preview`, `/owner/consent`, `/owner/grants`, `/owner/revoke` require server-verified Supabase identity/AAL2, active profiles.role='admin' and the pinned owner ID. Never trust user_metadata, UI role flags or an unverified JWT decode alone.
- [ ] Consent preview binds a pending request to its verified owner. Allow selects specific survey IDs and a separate image checkbox; denial/replay/expiry cannot create a grant. Consent is same-origin POST; return a validated exact registered callback for browser navigation. Preserve state, include issuer; never log codes/tokens.
- [ ] Register clients only through the owner endpoint with a captured exact HTTPS Google callback; no wildcard callback, URL username/password, fragment, arbitrary token endpoint or LeadMaps identity. Hash the one-time displayed client secret. Ask user confirmation before actual production client/access creation.
- [ ] Implement token/revoke endpoints with resource binding, one-use codes and rotation. Bearer values are random opaque connector tokens, not admin JWTs. Bound persistent rate limits use a non-reversible bucket identifier rather than logging IPs.
- [ ] Set limits explicitly: 60 authorization requests/minute per hashed network bucket, 20 token/owner mutations/minute per client or owner, 120 reads/minute per grant and 20 submissions/minute per grant. Return 429 with Retry-After; no new Redis/provider dependency. Canonical production origin is fixed in configuration, not taken from untrusted Host/X-Forwarded-Host.
- [ ] Run contracts, OAuth and real database suites; expect PASS. Commit OAuth module and focused tests.

## Task 4: Evidence projection and private advisory validation

**Files:** evidence.ts, advisory.ts, media.ts; tests/evidence.test.ts and advisory.test.ts.
**Interfaces:** `readEvidence(context: GrantContext,key: RevisionKey,deps: ConnectorDeps): Promise<{packet: EvidencePacket; images: Awaited<ReturnType<EvidenceMediaReader['read']>>}>`; `submitAdvisory(context: GrantContext,raw: unknown,deps: ConnectorDeps): Promise<SubmissionReceipt>`.

- [ ] Write failing tests injecting phone/address/GPS/private paths, rejected/stale findings, malicious notes and invented sources. Assert output contains none of those private fields; Brown Spot remains `affected_leaf`, BLB remains `disease_region`; unreviewed evidence is not labelled reviewed and no detection is not called healthy.
- [ ] Write submission assertions:
  ```ts
  assert.deepEqual(await submitAdvisory(ctx, validSubmission, deps), storedPrivateReceipt);
  await assert.rejects(() => submitAdvisory(ctx, {...validSubmission, source_ids: [invented]}, deps));
  await assert.rejects(() => submitAdvisory(ctx, {...validSubmission, evidence_sha256: staleDigest}, deps));
  assert.equal((await storeSnapshot()).publicPostCount, before.publicPostCount);
  ```
- [ ] Run both Deno tests; expect FAIL. Build evidence by explicit whitelist from an allowed immutable rg_result_revisions row and its real job/provenance. Do not call reviewedDiseaseScope/advisoryFacts with fabricated acceptance or write to rg_finding_reviews. Missing revision/provenance fails closed; missing crop/severity context stays unknown.
- [ ] Generate digest from a stable, explicitly ordered canonical evidence DTO: fixed object keys; sort source IDs and guidance versions by ID; preserve immutable source-asset order; omit volatile access URLs and checked_at from hashed evidence. Recompute it from the same live revision/active approved guidance before submission; do not trust the caller's digest. Map rg_result_revisions.revision to result_revision, use its real job_id/model version fields plus available pinned manifest hashes, and map rg_advisory_sources.source_reference to AdvisorySource.reference. Source IDs refer only to current active guidance relevant to detected supported diseases.
- [ ] Reuse validateAdvisoryDraft for structural/source checks; add revision/digest/idempotency validation and required limitations. Research citations are untrusted supplemental references, not automatically approved guidance. No arbitrary server URL fetcher is added: this avoids a new SSRF path. Do not claim schema validation proves agronomic correctness or confirms chemical doses.
- [ ] Image permission defaults off. When enabled, read only selected, consented EXIF-free original/combined derivatives already belonging to the same result, using the existing private signing helper internally. Return MCP image bytes, not signer URLs or bucket paths. Limit to two images, <=1 MiB each and <=2 MiB total; verify file signatures and EXIF/GPS absence. No arbitrary user URL/path. If safe derivatives are unavailable, return explicit text-only status, not a raw original fallback.
- [ ] Evidence text and image instructions are labelled untrusted content; source/notes cannot invoke tools. Store the advisory only in private submissions, recording model_self_reported separately from configured Task model. Rerun Deno and DB suites; expect PASS. Commit these modules/tests.

## Task 5: Standard MCP transport, routing and runtime checks

**Files:** server.ts; advisory-mcp/index.ts; deno.json/lock; tests/server.test.ts; connector hunks in supabase/config.toml and vercel.json.
**Interfaces:** `createConnectorHandler(deps: ConnectorDeps): (req: Request) => Promise<Response>`; index.ts alone wires real environment/store/media/auth and Deno.serve.

- [ ] Write failing HTTP tests for metadata JSON, anonymous 401 WWW-Authenticate challenge, wrong audience/scope, POST-only MCP, invalid origin, oversized body, and JSON-RPC initialize/tools/list/tools/call. Assert exactly these tools:
  ```ts
  assert.deepEqual(names.sort(), ['advisory_queue_summary','get_advisory_evidence','list_ready_evidence','submit_advisory'].sort());
  assert.equal(submit.annotations.readOnlyHint, false);
  assert.equal(result.status, 'stored_private');
  ```
- [ ] Run server test; expect FAIL. Use pinned MCP SDK WebStandardStreamableHTTPServerTransport, stateless enableJsonResponse. Per-request authorization and database permissions remain authoritative. Do not keep grants or pending writes only in Edge Function memory. Only three tools have readOnlyHint:true; submission has idempotent retry behavior, not a hidden read.
- [ ] Map exact website routes before the existing SPA catch-all: `/api/advisory-mcp` -> Supabase advisory-mcp `/mcp`; `/api/advisory-oauth/:path*` -> `/oauth/:path*`; `/.well-known/oauth-protected-resource/api/advisory-mcp` and `/.well-known/oauth-authorization-server` -> matching metadata handlers. Use the currently linked project URL, not an invented project. No caching auth, metadata challenge or private results.
- [ ] Add only `[functions.advisory-mcp] verify_jwt=false`; this handler supplies its own OAuth validation. Do not change gateway checks for existing functions. Validate allowed Origin when present; do not rely on CORS to authorize a server-side client.
- [ ] Check config JSON/TOML, test method/body/Authorization/query forwarding through a local/preview proxy, and ensure SPA navigation still works. A 200 HTML response is a failure for metadata/MCP. If Vercel external proxy strips required headers, stop and correct this adapter rather than weakening authentication.
- [ ] Run all backend Deno tests/check, real SQL tests and existing frontend advisory/review regression tests; expect PASS. Commit only connector config hunks and new server files.

## Task 6: Clear admin consent and connection management

**Files:** GeminiConnection.tsx, geminiConnector.ts, geminiConnector.ui.test.tsx; frontend/src/app/router.tsx.
**Interfaces:** `connectorOwnerAction<T>(action: string,input: unknown): Promise<T>` sends current verified admin session to the scoped owner endpoint; `GeminiConnectionPage()` renders consent or grant management.

- [ ] Write failing UI tests: unauthenticated/missing-MFA cannot consent; exact app/scopes/30-day limit and survey selection visible; images unchecked; deny does not grant; expired request asks to restart; double-click Allow cannot create two grants; revoke immediately changes visible state.
- [ ] Run `npm --prefix frontend test -- src/operations/geminiConnector.ui.test.tsx`; expect FAIL. Add `/admin/connect/gemini` under ProtectedRoute(role='admin'); preserve existing operations routes. Backend remains authoritative even when the frontend guard passes.
- [ ] UI shows **RiceGuardAI Advisory**, `evidence:read`, `advisory:submit`, expiry, selected fixture/surveys, image opt-in, and clear copy: "Mababasa ng Gemini ang pinili mong detection evidence at makakapag-save ng advisory. Hindi ito magpa-publish o magpapadala ng SMS sa setup test." Provide Allow and Deny, plus existing-grant expiry/Revoke. Disable submit while pending.
- [ ] Provide owner-only client setup with exact callback input and one-time secret display; never store the secret in localStorage, query strings or analytics. The agent stops for the user to enter/approve sensitive credentials and permissions at action time. Do not create a Gemini Task or grant access merely by opening this page.
- [ ] Server-returned redirect must match the registered HTTPS Google callback; no arbitrary returnTo from query. Preserve the pending request through ordinary login/MFA without embedding tokens in URLs. Treat failure as failure, not as connected.
- [ ] Rerun UI tests and frontend build/lint. Report unrelated baseline lint failures separately; fix only connector-introduced findings. Commit only new frontend files and the route hunk.

## Task 7: Isolated complete trial and release gate

**Files:** database/server/consent tests above; docs/gemini-connector-setup.md; tools/gemini-connector-smoke.mjs.
**Interfaces:** smoke tool consumes a base URL plus synthetic fixture/operator inputs supplied privately and produces a redacted PASS/FAIL receipt; no credentials or private URLs in its output.

- [ ] Write a failing round-trip test: synthetic pending request -> owner MFA consent -> code exchange -> read fixture -> store advisory -> identical retry -> revoke -> denial. Inject owner deactivation and survey revocation between read/write; both deny and leave no submission/public side effect.
- [ ] Implement the smoke harness without importing production secrets. Check hashes and SQL rows, not just generated text. Verify source/citation limits, image permission, bad Origin, stale evidence, code/refresh races and missing configuration. Test private fixture status `Needs review` without forging specialist review.
- [ ] Run: all Deno tests/check; `npm --prefix frontend test -- src/operations/geminiConnector.database.test.ts src/operations/geminiConnector.ui.test.tsx src/operations/advisoryEvidence.test.ts src/operations/reviewWorkflow.database.test.ts src/operations/reviewWorkflow.ui.test.tsx`; frontend build and lint. Record exact commands/results; do not claim live Gemini or PostgreSQL concurrency proof from a mock alone. PGlite is isolated PostgreSQL-compatible testing; perform the deployed transactional checks too.
- [ ] Perform local browser consent/accessibility checks (keyboard, mobile width, no secret persistence). Refresh the scoped code-only Graphify map at this checkpoint and inspect cited code. No cloud graph backend, watcher or broad data scan.
- [ ] Write release diff/rollback record: tested source hashes, exact new migration/function/config/route, runtime/dependency lock versions, how to disable connector/revoke its grants, and unchanged publication/SMS counts. Do not roll back by deleting user records or reverting all dirty changes.
- [ ] Present the exact artifact for deployment approval. Existing dirty checkout requires an isolated tested release assembled from the verified deployment baseline plus connector changes; never upload unrelated pending modifications or a broad generated bundle. Stop if the baseline cannot be established. Commit documentation/harness only after verification.

## Task 8: Approved deployment and user-operated Gemini confirmations

**Files:** docs/gemini-connector-setup.md; redacted output/gemini-connector verification receipt.
**Interfaces:** no new tools or permissions beyond the tested release and selected surveys in this plan.

- [ ] **STOP for deployment approval.** Identify target Supabase project/site and exact migration/function/rewrite/consent changes. Establish owner ID privately, with no broad role grant. Verify current official CLI help before every deployment/schema command; inspect a database dry-run and security advisors first. Do not apply unrelated pending migrations.
- [ ] Deploy only the approved isolated release; verify live HTTPS discovery, canonical issuer/resource, anonymous denial, and existing public/admin pages. Permission/connection is not active just because the endpoint responds.
- [ ] Open Gemini Create custom app, enter the verified live URL, capture its actual callback privately, and register only that client via the owner-approved screen. User performs credential entry if needed. No Google Cloud project or Gemini API key creation.
- [ ] **STOP at actual consent.** Show the exact scopes, selected evidence/images, Gemini destination and <=30-day duration; save a safe screenshot and ask the user to Allow only if they match. Do not click Allow on their behalf. Verify the app lists only the four intended tools.
- [ ] After the specific fixture read/share approval, select 4 Argon in a new Task and run one private fixture read. If images are enabled, ask Gemini to identify a known harmless marker; compare actual image content/tool results. A generic crop description is not proof. Record text-only/image-supported accurately.
- [ ] Run one private advisory submission. **STOP when Gemini asks for write confirmation** and tell the user which action/fixture it will save. If the platform does not offer the action, report the failure; never disguise it as read-only, automate an approval click or silently choose another product/model.
- [ ] Compare stored submission ID/revision/digest and audit timestamp with the tool result. Confirm no bulletin, campaign, SMS or finding review changed. Deliver setup instructions and expiry/revoke steps. Do not create the Gmail monitor or advertise unattended publication; those are later approved phases.

## Plan self-review and execution handoff

Coverage: minimal tools (1,4,5); OAuth/owner/MFA/permissions (1,2,3,6);
privacy/images/source limits (1,4); idempotency/races/revocation (2,3,7);
real website routing (5,7); private trial/no publication (2,4,7,8);
user confirmations/Argon (6,8). All five Review Focus cases have named test owners.

No code implementation, runtime installation, migration, deployment or grant has
been performed by creating this plan. Plan review and execution-method selection
remain required. Recommended execution: **Native**, task-by-task in this chat,
because the auth/store/transport contracts are tightly coupled. Do not spawn agents
unless the user selects delegation or an applicable approved execution skill requires it.

Primary references checked while planning:
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- https://supabase.com/docs/guides/functions/routing
- https://vercel.com/docs/routing/rewrites
- Official npm registry metadata for @modelcontextprotocol/sdk, zod and deno.
