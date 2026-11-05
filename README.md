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
  -> approval of public bulletin and approximate map
  -> separate SMS preview and approval for consent-checked recipients
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

## Pinned workflow and scientific limits

The current `kaggle_yolo26` pathway uses the immutable two-specialist model
bundle and worker SHA-256 in `_shared/pinnedResult.ts`. It does not select
its checkpoints from `rg_model_registry`. That optional adapter registry must
not be used as a readiness gate for the separately pinned pathway.

The Model and system page reads the upload, dispatch and callback flags from
the protected `system-readiness` action. Configured flags and credentials do
not prove current GPU availability or successful execution.

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

## Models used (not stored in this repository)

Model weights and training datasets are kept out of git (see `.gitignore`).
Each model is identified by its SHA-256 so a deployment can be checked.

| Model | Role | Where it runs | Identity |
| --- | --- | --- | --- |
| BLB specialist: U-Net ConvNeXt-B (DINOv3), smp 0.5.0 / timm 1.0.30 | Lesion mask for Bacterial Leaf Blight | Kaggle Tesla T4, 1024 px tiles, stride 768 | `blb.pt`, SHA-256 `7006f33bf08cdfe291a2e3907b28e9e71107289ad6ea81299c9c9b17e98bdf17` |
| Brown Spot specialist: YOLO26l semantic, ultralytics 8.4.115 | Lesion mask for Brown Spot | Kaggle Tesla T4, same tiling | `brownspot.pt`, SHA-256 `b311478a6c47e353c353b9ec060a3e885ad431394d7dade04b6972fd59060b33` |
| Photo classifier: ConvNeXt-Small (DINOv3), 3 classes (BLB, Brown Spot, Soil Nitrogen) | Informative per-photo percentages shown in Verify findings | Kaggle T4 inside the same job (ONNX fp32 from the private bucket, converted with onnx2torch), 24 tiles of 512 px at half resolution, input 384 | `riceguard-photo-classifier-20261026-fp32`, SHA-256 `aa85bf51dcc656347c21d01048b85314a9ea2e0fd02ad10228efb328a9c44c77` |
| Gemma 4 (`gemma4:31b`, Ollama Cloud) | Pre-upload photo check (crop stage, likely diseases, pests and nutrient conditions, photo quality) and the automated advisory text | Server side, `field-operations` `photo-insight` and `auto-pipeline` | Hosted model; no weights in this project |

- The two specialist checkpoints live in the private S3 bucket under
  `website-inference/v2/models/<sha256>.pt` and are handed to each Kaggle run
  as short-lived signed URLs after a hash check.
- The photo classifier (one fp32 ONNX file) is in the same private bucket at
  `website-inference/v2/models/<sha256>.onnx`, with its manifest beside it as `<sha256>.json`.
  The control Lambda returns a short-lived signed URL with the specialist URLs, and the worker checks the hash.
  An int8 export (`riceguard-photo-classifier-20261026-int8`, SHA-256
  `5becaac075045ce7b468edba7029972ad78c4b5b47f690698a7ed32073da6568`, 57 MB)
  exists but browsers no longer run the classifier.
- Durable copies: `OneDrive/AI-Assets/RiceGuardAI/2026-11-01/models/`.
- The classifier and Gemma 4 are informative only. Measured findings,
  severity and publication come from the two pinned specialists and the
  specialist's Tama / Mali / Hindi sigurado decisions.

## Release verification

The local SMS hook is disabled by default so linked read-only CLI checks do
not require a local signing secret. Production Auth hook configuration is
unchanged. To test a local SMS hook, load the real signing secret securely,
set `auth.hook.send_sms.enabled = true` and use
`secrets = "env(SEND_SMS_HOOK_SECRETS)"`. Never use a production phone number
or a placeholder secret for an uncontrolled test.

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
