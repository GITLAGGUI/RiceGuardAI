# Gemini connector release review

October 23, 2026, Philippines. Local candidate only; deployment is not authorized
by this report and no live grant has been created.

Subsequent update: the human approved deployment after reviewing this report.
Deployment is complete; current evidence and remaining Gemini connection gate
are recorded in `gemini-connector-live-receipt.md`. No actual grant exists yet.

## Verified baseline

Current `riceguardai.dev` production alias resolved through authenticated Vercel
CLI to `dpl_3dj2Q56wcLmd8cLde8p9UTX88Ah7`, a ready CLI deployment.
Its metadata names commit `42d66178ec037a3a2fc28c783a8c8919ca5feff8` but also
`gitDirty=1`; the commit alone is therefore not the deployed source of truth.

The API source-file identifiers were compared with SHA-1 hashes of the preserved
`qa/releases/readiness-20261013/stage` snapshot. All 87 selected source/config and
shared dependency files and all 40 public assets matched. The existing local
source receipt referred to a different deployment, so it was not accepted as
proof without this fresh comparison. Full per-file evidence is in
`gemini-live-baseline.json` and `gemini-live-assets.json`.

The Vercel connector returned a team-scope403. The existing CLI session succeeded
with the explicit same team/project scope; no new connection permission or team
was granted. Neither route used credentials in command arguments or reports.

## Candidate

`C:/Users/jenal/Dev/riceguard-gemini-release-20261023`

The assembly script copies a strict verified baseline allowlist, rechecks hashes,
then applies20 explicit connector overlays. It does not copy the dirty project,
source datasets, annotation ZIPs, private configuration or browser sessions.
The existing local dependency folder is linked solely for QA. Never recursively
delete that junction or include dependencies/build caches in a source upload.

Existing frontend changes against the verified baseline are only:

- One lazy admin connector route in `router.tsx`.
- Preserve the pending connector request through login and MFA in
  `ProtectedRoute.tsx` and `Login.tsx`.
- Explicit OAuth/discovery/MCP rewrites before the existing SPA fallback.

New frontend source is `GeminiConnection.tsx` and `geminiConnector.ts`.
The remaining overlays are the isolated backend function, its locked dependencies,
private SQL migration, and required shared code. Existing publication/SMS paths
are not replaced, and model inference is not redeployed by this candidate.

Initial candidate compilation caught four omitted existing shared dependencies.
Their hashes were then verified against the live source tree and they were added
unchanged. This was an assembly defect, not a reason to modify working application
types or suppress compiler errors. Final candidate build result must be recorded
before deployment approval is requested. The final candidate TypeScript/Vite build
passed (6304 modules; Vite1m54s), and its copied backend entrypoint typechecked.
Fresh baseline comparison confirmed exactly the four expected existing-file
changes and no unexpected changes among127 baseline files. Dependencies were
reused locally, not installed afresh; live provider configuration remains untested.

## Browser checks

Playwright opened the actual consent component with a loopback-only synthetic
auth/data fixture, visibly labelled as synthetic. This was not a real owner login.
At390px width, document width was390px: no horizontal overflow. Survey selection
enabled Allow; Tab then Space toggled the optional image checkbox. Initial survey
selection and image sharing were off. Empty-survey Allow was disabled. Expired
requests displayed an error and no consent buttons. The owner form displayed the
client name and exact callback fields. No Allow, Deny or Register write was sent.

Screenshots were inspected at desktop1366px and mobile390px:

- `output/playwright/gemini-consent-mobile.png`
- `output/playwright/gemini-consent-desktop.png`
- `output/playwright/gemini-owner-desktop.png`

The synthetic page's only resource error was an absent favicon. Actual live MFA,
screen-reader use, real Gemini callback, write confirmation and proxy behavior
remain unverified. Passing a synthetic component check does not establish those.

## Deployment approval scope

The next security-sensitive step requires explicit approval for this candidate:

1. Apply only `20261022185322_gemini_advisory_connector.sql` to the existing
   Supabase project `pekowozxnyyeskymjxyx`, after migration/security preflight.
   Never broadly push pending migrations or replace existing tables/functions.
2. Deploy only the new `advisory-mcp` function, with its own opaque OAuth checks
   and gateway JWT verification disabled for that function alone. Configure its
   pinned owner privately; keep image sharing off unless separately selected.
3. Release the baseline-preserving frontend route/login/rewrite changes to the
   existing RiceGuardAI Vercel project/domain, then run live regression checks.
4. Stop at the actual Gemini consent/write screen for human confirmation.

The connector saves private drafts only. No bulletin publishing, SMS, Gmail task,
API subscription, new cloud project or purchase is included in this approval.
Broader automation requirements remain listed in `gemini-connector-setup.md`.

## Rollback

Disable only the connector enable flag, revoke connector grants and remove its
rewrites if needed. For frontend rollback, use the recorded existing deployment
after explicit approval. Do not delete farmer records or undo unrelated changes.
