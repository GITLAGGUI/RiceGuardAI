# RiceGuardAI private connector: live deployment receipt

October 23, 2026, Philippines. The human explicitly approved the isolated private
connector deployment in this chat. Actual Gemini consent remains a separate step.

## Deployed and verified

- Existing Supabase project: `pekowozxnyyeskymjxyx`.
- Private connector schema: eight tables, all with RLS. Neither `anon` nor
  `authenticated` can execute `public.rg_mcp_store`; `service_role` can.
  Its SQL code is SECURITY INVOKER, not SECURITY DEFINER.
- The migration was first executed inside a transaction and rolled back as a
  dry-run. The rollback was verified before applying it once through MCP.
- Applied migration history: `20261022234735_gemini_advisory_connector`.
  Reviewed source file: `20261022185322_gemini_advisory_connector.sql`.
  MCP assigned the remote timestamp. These are the same SQL, not two migrations.
  Before any future CLI migration push, reconcile this version mapping; never
  replay the earlier filename or mark unrelated migrations as applied.
- Only the new `advisory-mcp` function was deployed. It is ACTIVE, version2,
  with its gateway JWT check off and its own opaque OAuth authentication on.
  The version advanced when its private server configuration was set.
- Pinned owner is the existing verified-email, MFA-enabled administrator whose
  email matches the user's account name, excluding smoke-test administrators.
  No user role or test account was created. Owner settings remain in ACL-restricted
  private local configuration and server secrets, not browser code or this report.
- Vercel deployment `dpl_B4U385cXRC8aZc6KpoaXjYfugRbE` was staged as production
  with `--skip-domain`, checked, then promoted under the approved existing team
  and project. `riceguardai.dev` resolves to the new deployment on inspection.

Public live checks after promotion:

| Route | Result |
| --- | --- |
| `/.well-known/oauth-authorization-server` |200 JSON, issuer `https://riceguardai.dev` |
| `/.well-known/oauth-protected-resource/api/advisory-mcp` |200 JSON, canonical resource |
| `/api/advisory-mcp` without credentials |401 JSON with OAuth resource challenge |
| `/api/advisory-oauth/owner/grants`, same origin but no session |403 owner sign-in/MFA required |
| `/` |200 existing RiceGuardAI SPA |
| `/admin/connect/gemini` |200 SPA; actual owner login/MFA still required |

The staged deployment was checked through authenticated Vercel curl. A raw
request to its protected URL initially returned Vercel authentication HTML200;
that was not accepted as application success. Discovery JSON, API401 and existing
SPA checks subsequently passed through the authenticated staged URL and live domain.

## No publishing or messaging

Counts before and after: public posts7, SMS outbox19, campaigns0, finding reviews78.
New connector clients0, grants0, submissions0. Nothing was sent to Gemini for
analysis, no bulletin was published, and no SMS or Gmail automation was triggered.

## Security findings retained honestly

The existing security advisor warnings were recorded before and after. No new
connector WARN/ERROR finding appeared. The eight additional INFO entries for
RLS without browser policies are intentional deny-by-default private tables.
Existing warnings remain for legacy SECURITY DEFINER functions, mutable function
search path, public extensions and disabled leaked-password protection. These
were not broadly changed as part of this narrowly approved release.

The remote build reported13 dependency vulnerabilities (2moderate,11high) in the
existing dependency tree. No `npm audit fix` or forced upgrade was run. A separate
dependency/security corrective pass is still needed; this is not a claim that
the entire existing application is security-clean.

## Actual remaining gate

Gemini's real custom-MCP dialog was opened in the user's Chrome session. It shows
an MCP Server URL field and Additional settings. No credentials were entered and
no app was connected. Browser control then disconnected (`Debugger unattached`),
so the agent stopped rather than clicking consent blindly or bypassing MFA.
The setup tab was marked for handoff.

Reconnect browser control/open Gemini Connected Apps, then continue with:

1. Enter `https://riceguardai.dev/api/advisory-mcp` in Gemini's custom app dialog.
2. Read the actual callback from Gemini, register only that exact callback through
   the owner MFA-protected page, and enter its one-time credentials privately.
3. Human performs the real consent for selected evidence/images, at most30days.
4. Verify the four tools and one expressly approved private fixture read/write.
   The human handles any write confirmation. Verify the actual selected Gemini
   model; no `4 Argon` claim has been inferred from a database field.

Until then, the connector is deployed but **not connected to Gemini** and is not
an unattended advisory workflow. Broader publishing/SMS/GPS/model/severity/UI
requirements remain later phases as already listed in the setup document.

## Recovery

Disable only `RG_GEMINI_CONNECTOR_ENABLED` and revoke connector grants to stop
access. Prior frontend deployment is `dpl_3dj2Q56wcLmd8cLde8p9UTX88Ah7` if an
approved rollback becomes necessary. Do not delete operational records or broadly
roll back unrelated migrations/functions.

## Connection continuation checkpoint

The user asked to continue. Browser control recovered. The real Gemini custom-app
form now contains the public RiceGuardAI MCP URL and Additional settings is open.
Its Copy redirect URI button visibly confirms Link copied, but the browser tool's
virtual clipboard remains empty. Clipboard read/readText and the intended paste
into the owner's callback field did not provide the URL; nothing was registered.
No OS clipboard workaround, guessed redirect URI or broadened callback allowlist
was used. The user was asked for the copied callback URL only, not a secret.

The live `/admin/connect/gemini` page loaded in the user's existing authenticated
MFA workspace and successfully displayed Existing connections and Owner client
setup with no grants. This verifies that the real owner read endpoint is usable;
it does not prove that Gemini OAuth or a private submission succeeds.

Both setup tabs were preserved for handoff. Screenshot:
`output/playwright/gemini-callback-handoff.png`.
Next: obtain the exact public callback URL, populate the intended registration
form, and pause at any action-time access confirmation. No client credentials,
grant, evidence read, publication or SMS was created in this continuation.

The human subsequently supplied the exact Google callback. The owner registration
form is populated with `RiceGuardAI Advisory` and that exact URI, without clicking
Register client. The human must register and enter its one-time credentials
privately in Gemini, then stop at actual consent. No client secret was collected
in chat or screenshots. Registration-ready proof is
`output/playwright/gemini-register-client-ready.png`.

## Actual pending consent inspected

The user registered the client privately and reached an OAuth request. A scoped
read-only database check confirmed that request was active, unused, and not yet
granted, with app name RiceGuardAI Advisory and exactly `evidence:read` and
`advisory:submit`. The real browser consent page then displayed those two scopes,
a maximum30-day grant, nine eligible surveys (all unchecked), image sharing off,
and Allow disabled pending selection. No selection or consent was made by the
agent. By the time the screenshot was captured the five-minute request had
expired, and `output/playwright/gemini-real-permissions.png` therefore shows the
expiry message, not the earlier permission list. Restart through Gemini Next;
do not create another client or extend/revive the expired request manually.

The user also clarified that every completed processing run should automatically
lead to an advisory. That remains the desired workflow, not current functionality.
Google's current official Tasks documentation explicitly supports Gmail monitors
triggered by matching incoming email, distinct from older chat scheduled actions:
https://support.google.com/gemini/answer/17094710?hl=en
https://support.google.com/gemini/answer/17094507?co=GENIE.Platform%3DDesktop&hl=en

A future implementation can use successful-processing event email to trigger an
eligible Gemini Task and read the exact authorized revision through MCP. It still
needs actual account verification, deduplication, error handling and a tested
private write before later publication/SMS changes. Monitors may be delayed and
some actions require human confirmation. No Gmail monitor or message was created
by this inspection, and no guarantee of immediate unattended writes was made.
