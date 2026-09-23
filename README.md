# RiceGuardAI

RiceGuardAI is a reviewed field-information platform for rice monitoring in
Region II. It preserves private drone originals, submits asynchronous private
Kaggle inference jobs, reconstructs independent BLB and Brown Spot semantic
masks, and requires an authorized staff review before any bulletin, map point,
or SMS campaign is created.

Public website: [riceguardai.dev](https://riceguardai.dev)

## Operational workflow

```text
Photo / MP4 / telemetry upload to private Google Drive
  -> size, type, dimensions, duration and checksum verification
  -> immutable batch manifest and Supabase queue
  -> private Kaggle notebook submission through the official Kaggle client
  -> independent BLB and Brown Spot tiled semantic inference
  -> native-coordinate result reconstruction and verified callback
  -> staff review of the exact result, media and approximate location
  -> approved specialist-grounded advisory draft
  -> one final approval
  -> public bulletin + approximate map + consent-checked SMS outbox
  -> accepted / delivered / failed receipt tracking
```

No live browser tab or always-on GPU is required after a verified upload and
cloud submission. GPU quota exhaustion is reported as `Waiting for GPU` and is
retried conservatively. There is no automatic paid AWS fallback.

## Stack

- React 19, Vite and TypeScript
- Supabase Auth, Postgres, RLS, Storage, Cron and Edge Functions
- Google Drive resumable uploads for private originals and large outputs
- Kaggle private notebook runs for asynchronous GPU processing
- Leaflet for private and approximate public maps
- Ollama Cloud provider adapter for structured advisory drafts
- SMS Gate Android device for outbound messages and delivery callbacks
- Vercel for the frontend and lightweight Python Kaggle dispatcher

## Local setup

```powershell
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

The browser receives only `VITE_SUPABASE_URL` and the public anon key. Never put
Kaggle, Google Drive, SMS Gate, Ollama, service-role, or worker credentials in a
`VITE_` variable.

## Database and functions

```powershell
supabase link --project-ref <project-ref>
supabase db push

supabase functions deploy field-operations
supabase functions deploy job-dispatcher --no-verify-jwt
supabase functions deploy job-reconciler --no-verify-jwt
supabase functions deploy worker-callback --no-verify-jwt
supabase functions deploy generate-advisory
supabase functions deploy send-sms --no-verify-jwt
supabase functions deploy sms-webhook --no-verify-jwt
```

Required Supabase function secrets:

```text
APP_ORIGIN=https://riceguardai.dev
CRON_SECRET=<random-long-secret>
GOOGLE_DRIVE_CLIENT_ID=<server OAuth client>
GOOGLE_DRIVE_CLIENT_SECRET=<server OAuth secret>
GOOGLE_DRIVE_REFRESH_TOKEN=<restricted application account refresh token>
GOOGLE_DRIVE_APP_FOLDER_ID=<private application folder>
KAGGLE_DISPATCH_URL=https://riceguardai.dev/api/kaggle
KAGGLE_DISPATCH_SECRET=<random-long-secret>
OLLAMA_API_KEY=<optional until specialist sources are approved>
OLLAMA_BASE_URL=https://ollama.com/api
OLLAMA_MODEL=<configured model>
SMS_GATE_URL=<gateway endpoint>
SMS_GATE_TOKEN=<gateway credential, or use user/password secrets>
SMS_GATE_WEBHOOK_SECRET=<webhook signing secret>
```

Add `riceguard_project_url` and `riceguard_cron_secret` to Supabase Vault. The
migration schedules dispatch, reconciliation and SMS outbox processing; missing
Vault secrets cause those jobs to fail closed without external calls.

## Vercel dispatcher

The `/api/kaggle` Python function uses the official Kaggle client only to push
and check a private kernel. Configure these Vercel server variables:

```text
KAGGLE_USERNAME=<account owner>
KAGGLE_KEY=<API credential>
KAGGLE_KERNEL_SLUG=riceguard-private-inference
KAGGLE_DISPATCH_SECRET=<same value configured in Supabase>
```

The dispatcher does not load checkpoints or process images. The generated
private Kaggle run obtains a short-lived, run-scoped worker token and receives
only its authorized manifest.

## Model registry and scientific limits

Two active model registry entries are required: `BLB` and `Brown Spot`. Each
entry pins its architecture, encoder, preprocessing, input size, overlap,
threshold, component filter, Drive artifact ID and SHA-256 checksum.

- BLB reports predicted disease-region coverage only after a visible-rice-leaf
  denominator is reviewed.
- Brown Spot reports affected-leaf coverage. Whole-leaf masks are not lesion
  severity.
- `Uncertain` remains an internal ignored label and is never public output.
- A completed empty result is `No target disease detected`, not proof that the
  crop is healthy.
- Low/Moderate/High stays disabled until a versioned disease-specific
  calibration is approved against independent, specialist-scored surveys.
- Video frame masks are timestamp aligned; repeated views are not summed into
  a field-area estimate.

## Release verification

```powershell
cd frontend
npm run lint
npm run test
npm run build
```

The release is not commissioned until one real image batch and one short video
complete upload -> Kaggle -> callback -> review -> publication -> approved test
SMS, with private/public access boundaries verified.

## Licensing

Educational and research use. Third-party asset notices are in
`THIRD_PARTY_NOTICES.md`.
