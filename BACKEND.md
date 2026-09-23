# RiceGuardAI backend reference

RiceGuardAI uses Supabase for identity, workflow records, queues, review data and public posts; Google Drive for private original media and large result files; Kaggle for asynchronous GPU inference; and the Android SMS Gate for approved alerts.

## Production workflow

```text
private Drive upload
  -> verified immutable manifest
  -> rg_processing_jobs queue
  -> job-dispatcher
  -> Vercel Python Kaggle dispatcher
  -> private Kaggle notebook
  -> worker-callback + artifact validation
  -> exact result revision review
  -> advisory draft
  -> one approval transaction
  -> sanitized public post + SMS outbox
```

The browser never receives Google refresh tokens, Kaggle credentials, the Supabase service-role key or SMS gateway credentials.

## Current operational tables

| Table | Purpose |
|---|---|
| `rg_surveys` | Survey metadata, private capture location and active revisions |
| `rg_assets` | Original asset metadata, hashes, Drive IDs and upload state |
| `rg_processing_jobs` | Leased, idempotent Kaggle work queue |
| `rg_job_callbacks` | Replay-safe worker progress/completion events |
| `rg_model_registry` | Replaceable BLB and Brown Spot specialist checkpoints and preprocessing |
| `rg_result_revisions` | Immutable validated result manifests for review |
| `rg_bulletins` | Draft/review/publication state and approved advice |
| `rg_public_posts` | Sanitized public projection with approximate location only |
| `rg_contacts` | Subscriber consent, verified phone, farm location and preferences |
| `rg_campaigns` / `rg_sms_recipients` | Campaign and per-recipient delivery state |
| `rg_advisory_sources` | Agriculture-specialist-approved guidance used for drafts |
| `rg_severity_calibrations` | Versioned disease-specific calibration; inactive until validated |
| `rg_audit` | Security and operational audit trail |

`Uncertain` is an internal ignored-pixel meaning and is never a public disease. A successful empty result is **No target disease detected**, not proof that plants are healthy. Historical Rice Blast names remain only in immutable audit/history records and are not silently renamed.

## Edge functions

| Function | Responsibility |
|---|---|
| `field-operations` | AAL2 admin snapshot, upload session, completion verification, review, drafting, recipient preview and exact-revision publication |
| `job-dispatcher` | Claims one queued job and asks the Vercel dispatcher to submit it to Kaggle |
| `job-reconciler` | Reconciles uncertain/running notebook state and bounded failures |
| `worker-callback` | Authenticated run-scoped progress and replay-safe result completion |
| `generate-advisory` | Structured draft from validated findings and approved guidance only |
| `send-sms` | Consent recheck, quiet hours, idempotent outbox send and bounded retry |
| `sms-webhook` | HMAC-authenticated delivery receipts and inbound STOP handling |
| `auth-sms-hook` | Authentication OTP relay only; separate from alert subscription consent |

`ai-advisor` and `infer-scan` are retired compatibility endpoints and return `410`. Browser-click inference and browser-resident model processing are not part of the production workflow.

## Kaggle runner and Vercel dispatcher

- `api/kaggle.py` is a short HMAC-authenticated Python function using the official Kaggle client. It submits and checks private notebook runs; it does not load a model or decode video.
- `workers/kaggle/runner.py` downloads authorized originals and pinned checkpoints, verifies hashes, runs independent BLB/Brown Spot specialist adapters, reconstructs overlapping tiles in native coordinates, preserves video timing, uploads private results to Drive and reports a validated manifest.
- Kaggle quota exhaustion produces `waiting_for_quota`; there is no automatic paid AWS fallback.
- Only one batch is active initially. Leases, unique run IDs and reconciliation protect against duplicate submissions.

## Measurements and severity

BLB reports predicted diseased-region coverage. Brown Spot reports predicted affected-leaf coverage because the current Brown Spot masks include green tissue on the affected leaf. These values are not interchangeable.

Automatic Low/Moderate/High values stay disabled until a disease-specific calibration has been approved using independent, agriculture-specialist-scored surveys and a reviewed visible-rice-leaf denominator. Until then the API returns `Severity not yet calibrated` with available measurements. It never divides by the whole frame or reports coverage of one image as whole-field severity.

## Required secrets

### Supabase Edge Function secrets

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_APP_FOLDER_ID`
- `KAGGLE_DISPATCH_URL`, `KAGGLE_DISPATCH_SECRET`
- `WORKER_CALLBACK_SECRET`
- `OLLAMA_API_KEY`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`
- `SMS_GATE_URL`, `SMS_GATE_USER`, `SMS_GATE_PASS`, `SMS_WEBHOOK_SECRET`
- `RG_PUBLIC_BASE_URL`

### Vercel server secrets

- `KAGGLE_USERNAME`, `KAGGLE_KEY`
- `KAGGLE_DISPATCH_SECRET`
- `KAGGLE_KERNEL_SLUG`

### Browser variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

No privileged key belongs in a `VITE_*` variable or notebook source.

## Deployment order

```powershell
# Link once to the intended Supabase project, then inspect before applying.
npx supabase db push --dry-run
npx supabase db push

npx supabase functions deploy field-operations
npx supabase functions deploy job-dispatcher --no-verify-jwt
npx supabase functions deploy job-reconciler --no-verify-jwt
npx supabase functions deploy worker-callback --no-verify-jwt
npx supabase functions deploy generate-advisory
npx supabase functions deploy send-sms --no-verify-jwt
npx supabase functions deploy sms-webhook --no-verify-jwt
npx supabase functions deploy auth-sms-hook --no-verify-jwt
```

Apply real secrets through the Supabase/Vercel secret stores. Do not commit them. Admin accounts are invite-only and must hold an active server-side admin role plus AAL2/MFA.

## Release gates

Before public launch, verify one real photo and one short real video through upload, browser-closed Kaggle submission, result return, exact-revision review, publication, approximate public map entry and one approved test SMS. Also verify duplicate callback, quota wait, interrupted upload, missing GPS, gateway offline, opt-out, quiet hours and stale-review rejection.

The repository can be build-complete without being commissioned. It becomes operational only after the migration, functions and secrets are deployed and the real end-to-end trial passes.
