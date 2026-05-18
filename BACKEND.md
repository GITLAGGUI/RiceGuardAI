# RiceGuard Backend Reference

Everything in `supabase/` — Postgres schema, RLS, Edge Functions, helpers.

```
supabase/
  config.toml                            Local CLI config (project ref = pekowozxnyyeskymjxyx)
  seed.sql                               Local-only sample data (NOT pushed to prod)
  migrations/
    0001_init.sql                        Tables + enums + triggers + RPC create_scan_with_detections
    0002_rls.sql                         Row-Level Security on every table + storage policies
    0003_advisory_helpers.sql            find_nearby_farmers / get_advisory_context / assign_farmer_to_detection
    0004_audit.sql                       audit_events table + triggers
    0005_seed.sql                        Default notification prefs (production-safe)
    0006_nearby_detections.sql           find_nearby_detections for weekly digest
  functions/
    _shared/
      cors.ts                            CORS preflight + jsonResponse helpers
      ratelimit.ts                       Hourly-bucket rate limiter using rate_limits table
      knowledge.ts                       Structured PhilRice/DA RII KB per disease + severity
    auth-sms-hook/                       Supabase Auth → SMS Gate OTP relay
    send-sms/                            SMS sender (advisory_id-aware, prefs-aware)
    ai-advisor/                          Ollama Cloud (gemma4:31b-cloud), field + sms modes
    generate-advisory/                   One-shot: detection_id + farmer_id → drafted advisory
    weather/                             OpenWeather + Tagalog agronomy insights, 10min cache
    weekly-digest/                       pg_cron-driven weekly SMS summary
    infer-scan/                          STUB for future YOLO inference (returns 501)
```

## Database tables

| Table | Purpose | RLS |
|---|---|---|
| `profiles` | farmer + admin metadata; `id → auth.users(id)`; has `lat`/`lng` for geo search | self read/update; admin all |
| `drone_scans` | uploaded scans | admin only |
| `disease_detections` | one row per pin marker (disease, severity, lat, lng, bbox) | admin all; farmer own |
| `advisories` | single source of truth — collapses old `alert_history` | admin all; farmer own |
| `notification_preferences` | per-farmer opt-ins | self only |
| `audit_events` | log of admin actions (scan.create, advisory.state_change, sms.sent, etc.) | admin read |
| `login_audit` | optional security trail | admin read |
| `weather_cache` | 10-min OpenWeather cache | service role only |
| `rate_limits` | hourly buckets for edge fn rate limiting | service role only |

## Enums

```sql
user_role:      'farmer' | 'admin'
disease:        'rice_blast' | 'bacterial_leaf_blight' | 'tungro'
severity:       'low' | 'medium' | 'high'
scan_status:    'pending' | 'processing' | 'completed'
delivery:       'queued' | 'sent' | 'failed'
advisory_state: 'draft' | 'approved' | 'sent'
```

## Helper functions

All are `security definer` and explicitly granted to `authenticated`.

| Function | Purpose |
|---|---|
| `is_admin()` | Returns true if `auth.uid()` has role admin. Used by every RLS policy. |
| `create_scan_with_detections(p_scan, p_detections)` | Atomic insert: 1 scan + N detections. Returns `{ scan_id, detection_ids }`. |
| `find_nearby_farmers(lat, lng, radius_km)` | Active farmers within radius, sorted by distance. Uses `earthdistance` + GIST index. |
| `find_nearby_detections(lat, lng, radius_km, since)` | Recent detections near a point. Used by weekly digest. |
| `get_advisory_context(advisory_id)` | One-shot read-model: advisory + detection + farmer + prefs as jsonb. |
| `assign_farmer_to_detection(detection_id)` | Auto-assign nearest farmer to a detection. |
| `count_pending_advisories()` | Badge counter for admin nav. |
| `set_updated_at()` | Trigger fn on advisories + notification_preferences. |
| `audit_scan_create()` | Trigger fn that logs every scan insert. |
| `audit_advisory_state()` | Trigger fn that logs every advisory state transition. |
| `handle_new_user()` | Trigger on `auth.users` insert — bootstraps a `profiles` row. |

## Edge Function reference

All require Supabase JWT in `Authorization: Bearer <token>` except `auth-sms-hook` (called by Supabase Auth itself) and `weekly-digest` (uses service role or `x-cron-secret`).

### `auth-sms-hook`
Triggered by Supabase Auth's *Send SMS hook*. Relays OTP through SMS Gate.
- **Env:** `SMS_GATE_USER`, `SMS_GATE_PASS`
- **Format:** `RiceGuard: Iyong code ay 123456. Wag ibahagi. (5 min)`

### `send-sms`
Sends an SMS. Two calling shapes:
- `{ advisory_id }` — fetches phone + body + prefs from the advisory row. Updates `sms_status`, `sms_sent_at`, `state='sent'` on success. **Respects `notification_preferences.sms_enabled` and `critical_alerts`** (returns `skipped: true` if opted out).
- `{ phone, body }` — free-form, admin-only.
- **Rate limits:** 5/hour/phone, 200/day global.

### `ai-advisor`
Generates Tagalog text from Ollama Cloud (`gemma4:31b-cloud`).
- **Modes:** `field` (4–5 numbered steps, ≤520 tokens) or `sms` (≤280 chars).
- **KB injection:** structured knowledge from `_shared/knowledge.ts` is added to every prompt — model never invents dose or chemical names.
- **Fallback:** if Ollama times out (15s), returns canonical KB action list. No hard failures.
- **Rate limit:** 30/hour/user.

### `generate-advisory`
One-shot: takes `detection_id + farmer_id` →
1. Loads detection + farmer
2. Optionally fetches weather snapshot at detection coords
3. Calls `ai-advisor` in parallel for `field` + `sms` text
4. INSERTs `advisories` row with `state='draft'`, `ai_generated=true`
5. Audits the action
6. Returns `{ advisory_id, model, advice_preview }`

The admin scan-upload flow calls this once per medium/high detection.

### `weather`
Wraps OpenWeather current + 5-day forecast.
- **Cache:** 10-minute disk in `weather_cache`, keyed by `lat:lng` rounded to 3 decimals.
- **Tagalog agronomy insights** generated deterministically (no AI):
  - Humidity >85% + temp 22–28°C → "Mataas ang panganib ng Rice Blast"
  - Wind <5 m/s + PoP <30% → "Magandang oras mag-spray"
  - PoP >60% → "Huwag mag-spray — malamang umulan"
  - Wind >8 m/s → "Malakas ang hangin — masamang oras para sa spraying"

### `weekly-digest`
Cron-triggered weekly summary. Loops over farmers with `weekly_summary=true`, finds detections within 10 km in the last 7 days, sends one SMS per farmer summarizing count + max severity.

Wire to `pg_cron` (Sundays 06:00 Asia/Manila = Saturday 22:00 UTC):
```sql
select cron.schedule(
  'rg-weekly-digest',
  '0 22 * * 6',
  $$ select net.http_post(
       url := 'https://pekowozxnyyeskymjxyx.functions.supabase.co/weekly-digest',
       headers := jsonb_build_object(
         'authorization', 'Bearer ' || current_setting('app.service_role_key'),
         'content-type','application/json'
       ),
       body := '{}'::jsonb
     ) $$
);
```

### `infer-scan`
**Stub.** Returns 501 with a clear next-steps message. When you have a trained YOLOv8 model, replace this with either:
- **Hosted inference** (Roboflow / Replicate / HF Inference) — easiest
- **Self-hosted ONNX** (onnxruntime-web in Deno) — fully serverless

The admin ScanUpload page already has a place for a "Run AI inference" button (currently absent, easy to add later).

## Secrets — what goes where

| Secret | Where | Why |
|---|---|---|
| `OLLAMA_API_KEY` | Supabase Edge Fn secret | Calls Ollama Cloud server-to-server. Never reaches browser. |
| `OLLAMA_BASE_URL` | Edge Fn secret | Defaults to `https://ollama.com/api`. |
| `OLLAMA_MODEL` | Edge Fn secret | `gemma4:31b-cloud`. |
| `SMS_GATE_USER` + `SMS_GATE_PASS` | Edge Fn secret | Basic Auth to SMS Gate. |
| `OPENWEATHER_API_KEY` | Edge Fn secret | Server-side weather fetch. |
| `CRON_SECRET` | Edge Fn secret (optional) | Alternative auth for weekly-digest if not using service role. |
| `VITE_SUPABASE_URL` | Vercel env + `frontend/.env.local` | Public — embedded in client bundle. |
| `VITE_SUPABASE_ANON_KEY` | Vercel env + `frontend/.env.local` | Public — RLS protects data. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Supabase only** — NEVER in Vercel or git | Edge functions auto-receive this via `Deno.env`. |

## Deploy to your project (`pekowozxnyyeskymjxyx`)

```powershell
# 1. Install Supabase CLI (one-time)
scoop install supabase          # or: iwr -useb https://github.com/supabase/cli/releases/latest/download/supabase_windows_amd64.exe -outfile $env:USERPROFILE\bin\supabase.exe

# 2. Login + link
supabase login                  # opens browser
cd C:\1XAMPP\htdocs\RiceGuard
supabase link --project-ref pekowozxnyyeskymjxyx
# (skip `supabase init` — supabase/ already exists)

# 3. Apply migrations
supabase db push

# 4. Set secrets (replace placeholders with your real values — never commit these)
supabase secrets set `
  OLLAMA_API_KEY=<YOUR_OLLAMA_KEY> `
  OLLAMA_BASE_URL=https://ollama.com/api `
  OLLAMA_MODEL=gemma4:31b-cloud `
  SMS_GATE_USER=<YOUR_SMS_GATE_USER> `
  SMS_GATE_PASS=<YOUR_SMS_GATE_PASS> `
  OPENWEATHER_API_KEY=<YOUR_OPENWEATHER_KEY>

# 5. Deploy Edge Functions
supabase functions deploy auth-sms-hook --no-verify-jwt
supabase functions deploy send-sms
supabase functions deploy ai-advisor
supabase functions deploy generate-advisory
supabase functions deploy weather
supabase functions deploy weekly-digest --no-verify-jwt
supabase functions deploy infer-scan
```

## Promote yourself to admin

After registering with your real phone via `/register`:

```sql
update public.profiles set role = 'admin' where phone = '+63XXXXXXXXXX';
```

Run this in Studio → SQL editor.

## Supabase Studio configuration

After `supabase db push` succeeds:

1. **Authentication → Providers → Phone**: enable. OTP length 6, expiry 600s.
2. **Authentication → Hooks → Send SMS hook**: enable. URL = `https://pekowozxnyyeskymjxyx.functions.supabase.co/auth-sms-hook`.
3. **Storage → Buckets**: confirm `scans` bucket exists and is private (created by 0002_rls.sql).
4. **Database → Functions**: verify the helpers and triggers from 0003 + 0004 are registered.
5. (Optional) **Database → Extensions**: ensure `pg_cron` + `pg_net` are enabled for `weekly-digest`.

## End-to-end smoke test

1. Register on `/register` with your phone → receive OTP via SMS Gate → land on `/farmer/home`.
2. Promote to admin via SQL above → refresh → `ProtectedRoute` will route you to `/admin/overview`.
3. Go to **Admin → Scans → New Scan** → name it, click 2–3 points on the Isabela map, set diseases + severity, save with "auto-generate advisories" checked.
4. Toast says "Drafted N advisories." → click **Review advisories**.
5. Click a draft → AdvisoryCompose loads with AI-drafted Tagalog text already populated.
6. Edit if needed → **Approve & send SMS**. Within ~10s, the linked farmer's phone receives the SMS.
7. Switch to farmer session → `/farmer/alerts` shows the new advisory; `/farmer/map` shows the pin with severity color.

If anything fails, check `audit_events`:

```sql
select created_at, action, meta from public.audit_events order by created_at desc limit 20;
```
