# RiceGuard AI

Drone-based rice disease detection + automated Tagalog advisory + SMS notification for smallholder rice farmers in Isabela and Cagayan (Region II, Philippines).

> **Stack:** Vite + React 19 + TypeScript + Tailwind v4 + Supabase + Vercel.
> Detects three diseases: **rice blast**, **bacterial leaf blight**, **tungro**.
> Farmer UI: Tagalog. Admin UI: English. Both mobile-friendly.

## What's inside

```
RiceGuard/
  frontend/             Vite + React + TS SPA (Vercel target)
  supabase/             Postgres migrations + Edge Functions (Deno)
  _legacy/              Old PHP + JS-React code, kept for reference only
```

## Quick start (local dev)

### 1. Install Supabase CLI + dependencies

```powershell
# Supabase CLI: https://supabase.com/docs/guides/local-development/cli/getting-started
scoop install supabase   # or: npm i -g supabase

# Frontend deps
cd frontend
npm install
```

### 2. Start local Supabase

```powershell
cd ..
supabase start   # boots local Postgres + Auth + Storage + Edge Functions emulator
supabase db push # applies migrations from supabase/migrations/
```

The CLI prints `API URL`, `anon key`, `service_role key`, and `Studio URL`. Copy them.

### 3. Configure frontend env

```powershell
copy frontend\.env.example frontend\.env.local
# Edit frontend/.env.local:
#   VITE_SUPABASE_URL=http://127.0.0.1:54321
#   VITE_SUPABASE_ANON_KEY=<anon key from `supabase status`>
```

### 4. Configure Edge Function secrets

```powershell
supabase secrets set OLLAMA_API_KEY=<your-ollama-cloud-key>
supabase secrets set OLLAMA_BASE_URL=https://ollama.com/api
supabase secrets set OLLAMA_MODEL=gemma4:31b-cloud
supabase secrets set SMS_GATE_USER=<sms-gate-user>
supabase secrets set SMS_GATE_PASS=<sms-gate-password>
supabase secrets set OPENWEATHER_API_KEY=<openweather-key>
```

> The Ollama API key, SMS Gate credentials, and OpenWeather key live **only** in Supabase Edge Function secrets. They never reach the browser bundle or git.

### 5. Run the frontend

```powershell
cd frontend
npm run dev   # http://localhost:5173
```

### 6. Local OTP login

`supabase/config.toml` reserves `+639000000000` with fixed OTP `123456` for local testing — use that phone number on `/login` to skip real SMS during dev.

To make yourself admin in the local DB, run in Studio SQL editor:

```sql
update public.profiles set role = 'admin' where phone = '+639000000000';
```

## Deploy

### Supabase

```powershell
supabase link --project-ref <project-ref>
supabase db push                            # apply migrations to remote
supabase functions deploy auth-sms-hook
supabase functions deploy send-sms
supabase functions deploy ai-advisor
supabase functions deploy weather
supabase secrets set OLLAMA_API_KEY=... SMS_GATE_USER=... SMS_GATE_PASS=... OPENWEATHER_API_KEY=... OLLAMA_BASE_URL=... OLLAMA_MODEL=...
```

In Supabase Studio:

- **Auth → Providers → Phone**: enable, OTP length 6, expiry 600s.
- **Auth → Hooks → Send SMS hook**: URL = `https://<project-ref>.functions.supabase.co/auth-sms-hook`.
- **Storage**: confirm bucket `scans` exists (created by migration).

### Vercel

1. Connect the GitHub repo at https://vercel.com/new.
2. Framework preset: **Vite**.
3. Build command: `cd frontend && npm install && npm run build` (already set in `vercel.json`).
4. Output directory: `frontend/dist`.
5. Environment variables (Settings → Environment Variables):
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
6. Click Deploy.

## Architecture

See `C:\Users\jenal\.claude\plans\based-on-my-project-lazy-piglet.md` for the full plan, architecture diagram (Mermaid), schema, RLS rules, and phased delivery.

**TL;DR pipeline:**

```
Admin uploads drone image
  → marks affected spots on Leaflet map (disease + severity)
  → INSERT drone_scans + N disease_detections
  → for severity ≥ medium, call ai-advisor (mode=field) → INSERT advisories (state=draft)
  → admin opens AdvisoryCompose, generates SMS draft, edits
  → click "Approve & send" → call send-sms → SMS Gate → farmer's phone
  → state=sent, sms_status=sent
  → farmer sees alert in /farmer/alerts + /farmer/map
```

## Project status

Currently in **Phase 1 (Bootstrap)** of a 5-phase rebuild.

- ✅ Phase 1 · Bootstrap: repo, migrations, edge functions, all pages + layouts scaffolded
- ⏳ Phase 2 · Auth wiring: deploy to real Supabase project, test phone OTP flow end-to-end
- ⏳ Phase 3 · Core data: storage bucket policies, scan upload + marker UI smoke test
- ⏳ Phase 4 · Advisory pipeline: AI compose + SMS send end-to-end
- ⏳ Phase 5 · Landing + UX polish + Lighthouse QA

## License

Educational / research use only.
