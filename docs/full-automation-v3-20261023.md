# RiceGuardAI full automation v3 (23 Oct 2026)

Goal: an upload becomes a published, SMS-delivered advisory with no staff input.
Specialists only accept or reject each AI finding afterwards. Until they do, the
public post carries a `?` badge ("AI pa lang ito, hindi pa nave-verify").

## What changed from the Codex/Gemini design

The Gemini route is dropped. On 23 Oct it failed three ways: Task mode returned
"Transport for env PROD not found", Gemini could not see the images through the
custom app, and custom-app writes need a manual confirmation, so it can never run
unattended. Ollama Cloud (`gemma4:31b`, key already stored as `OLLAMA_API_KEY`)
sees images directly, has a web-search API on the same key, and is called from
our own server, so nothing waits on a human. The Gemini connector and Gmail relay
stay deployed but switched off; nothing depends on them.

Gmail is not needed as a trigger. The trigger is the inference callback itself.

## Pipeline

```
Upload (browser)
  -> originals to the private Google Drive app folder (already live)
  -> Kaggle GPU job (b10 UNet ConvNeXt-B DINOv3 for BLB, YOLO26l-sem for Brown Spot)
  -> worker-callback "complete-v2" (verified private artifacts in S3)
       -> rg_complete_pinned_job (result revision, draft bulletin)
       -> auto-pipeline edge function (fire-and-forget + cron sweeper)
            1. severity math (representative image, IRRI SES)
            2. place name from coordinates (PostGIS barangay polygons)
            3. public media copy (original + per-disease colour layers + combined)
            4. Ollama: plan searches -> web_search -> advisory with cited sources
            5. publish provisionally (verification_status = unverified)
            6. enqueue SMS to consenting verified farmers within 3 km
  -> specialist later: Accept / Reject per finding (one tap each)
       -> all accepted: badge becomes "Verified"
       -> some rejected: disease removed, severity and advisory regenerate, post updated
       -> all rejected: post retracted, correction SMS to the same recipients
```

Reliability: the callback starts the pipeline with `EdgeRuntime.waitUntil`, and
`pg_cron` re-runs any survey whose `auto_status` is still `pending` or `retry`
every 2 minutes (max 6 attempts, then `failed`, shown in the monitor). Each step
is idempotent and records its own row in `rg_pipeline_steps`, so a retry resumes
where it stopped.

Realtime monitoring: the admin "Live pipeline" panel subscribes to Supabase
Realtime on `rg_pipeline_steps`, `rg_surveys` and `rg_processing_jobs`; every
stage change appears without refresh. This is the cloud equivalent of an
OpenClaw channel: a database event is the trigger and a Realtime channel is the
feed.

## Severity math

Masks from both new models are lesion polygons (BLB v2: 5,780 lesion polygons
over 200 tiles; Brown Spot v2: spot polygons), so lesion area / plant area is a
real "% diseased leaf area", the quantity the IRRI SES scales use.

Per photo `i`, computed on the GPU worker from full-resolution pixels:

- `P_i` plant tissue = green vegetation (Excess Green `2g - r - b` on chromatic
  coordinates, Otsu threshold clamped to [0.02, 0.20]) OR yellow/brown leaf tissue
  (HSV hue 15–60 deg, S >= 0.25, V >= 0.20) OR any disease mask. Very dark,
  glare and sky pixels fall out automatically.
- `D_i,d` lesion pixels for disease `d` after removing specks under 25 px.
- `S_i,d = 100 * D_i,d / P_i` (percent of visible plant tissue diseased).
- A photo with `P_i` under 2 % of the frame (soil, sky, blur) is not used.

Representative image (the user's rule, made resolution-safe): for each disease,
take the photo with the largest `S_i,d`. Raw pixel counts are not compared
directly because a 48 MP photo has four times the pixels of a 12 MP one; the
fraction is the same idea ("the worst photo") without that bias. Ties go to the
larger `D_i,d`. Uploading 1, 3, 5 or 10 photos never dilutes the result: one bad
photo is enough to flag the field, and many healthy photos cannot average it away.

Category from the IRRI Standard Evaluation System (SES) for Rice:

| Disease | SES band (% diseased area) | RiceGuard category |
| --- | --- | --- |
| BLB | 0–12 % (SES 0, 1, 3) | Low |
| BLB | 13–25 % (SES 5) | Moderate |
| BLB | > 25 % (SES 7, 9) | High |
| Brown Spot | 0–5 % (SES 0–3) | Low |
| Brown Spot | 6–15 % (SES 4–5) | Moderate |
| Brown Spot | > 15 % (SES 6–9) | High |

Field category = the highest disease category. Incidence (photos with the disease
/ usable photos) is reported next to it as context, not mixed into the grade. The
public post shows the SES score, the percent, which photo was used, and the
formula, so anyone can check it.

## Location

- Every photo has EXIF/DJI GPS: the field pin is the median of the photo points,
  set automatically.
- Any photo lacks GPS: the upload form asks for one manual pin before submitting.
- Either way the server resolves `Barangay, Municipality/City, Province` from
  2,311 PSGC 2023 barangay polygons stored in PostGIS (source:
  faeldon/philippines-json-maps, all 2,311 codes match `rg_locations`). A point in
  a polygon gap uses the nearest barangay within 500 m; beyond that only the
  municipality is named.
- Published field locations are public (decided by the user). Farmer names, phone
  numbers and farm addresses stay private.

## Advisory (Ollama gemma4:31b)

1. Plan: the model receives findings, severity, crop stage, field conditions,
   weather, and the representative overlay + original image, and returns 2–4
   search queries.
2. Research: `POST https://ollama.com/api/web_search` for each query; results from
   IRRI, PhilRice, DA, FAO, BPI and universities rank first; at most 6 sources kept.
3. Write: the model returns JSON `{summary, actions[], watch_for[], sources[]}` in
   natural, direct Taglish, citing only the numbered sources it was given. A
   validator rejects unknown source numbers, pesticide doses without a cited
   source, and empty actions; one retry, then the approved-guidance template.

## Specialist review (non-technical)

One screen per survey: each photo shows the AI finding and two big buttons,
"Tama" (accept) and "Mali" (reject). Rejecting opens one dropdown: "Walang sakit
sa larawan", "Ibang sakit", "Malabo / hindi makita", "Iba pa (pakisulat)". Only
"Iba pa" shows a text box. Everything else (severity, location, advisory,
publishing, SMS) is already done and only shown for reference.

## Models and Kaggle worker

- New private bundle `riceguard-b10unet-yolo26l-20261023` in the existing S3
  bucket: BLB = b10 fold_a fp16 (`smp 0.5.0`, `timm 1.0.30`, tile 1024, stride
  768, ImageNet normalisation, sigmoid >= 0.5); Brown Spot = YOLO26l LOSO-0002
  (`ultralytics 8.4.115`, semantic).
- Overlays: BLB yellow, Brown Spot red, no text or boxes; the website draws the
  legend. Each photo also gets transparent per-disease PNG layers (max 2048 px) so
  the bulletin can toggle the original (eye icon) and highlight one disease on hover.
- The Gemini advisory-media step is removed from the worker package.
