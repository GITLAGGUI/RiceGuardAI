# RiceGuardAI: source-grounded, location-aware advisory automation

**Status:** Codex implementation specification, prepared 2026-09-28 (Asia/Manila). This is **not** a deployment report or evidence of specialist approval. Existing code was read from `GITLAGGUI/RiceGuardAI` (`main`) on this date; inspect the checkout and deployed version again before edits.

## 1. Intended outcome

For a RiceGuard field or community, automatically **collect** verified weather, relevant current agricultural reports, approved specialist guidance and validated BLB/Brown Spot model findings; **evaluate** conflicts, uncertainty and timeliness; **draft** a clear Filipino/Taglish advisory with claim-level references; and **route to qualified staff for approval** before public bulletin/map publication or opt-in SMS. A farmer-facing weather-prevention view may show verified weather/official warnings without presenting unreviewed AI disease advice as official.

A ChatGPT Plus/Pro account is not the production runtime: the deployed backend must call the OpenAI API with its own key, billing, rate limits and server-side configuration. OpenWeather needs a separate account/key and the subscription appropriate for the selected endpoint.

## 2. Preserve the present architecture

Read `README.md`, `BACKEND.md`, `BACKEND_ARCHITECTURE.md`, relevant migrations and actual routing. The currently documented production path is: private upload -> Kaggle BLB/Brown Spot segmentation -> validated immutable result revision -> authorized staff review -> `rg_bulletins` advisory draft -> one final approval -> sanitized public bulletin/map -> consent-checked SMS outbox. The existing `generate-advisory` function currently uses approved `rg_advisory_sources` with an Ollama Cloud/template path. `weather` currently uses OpenWeather `/data/2.5/weather` and `/data/2.5/forecast`, `cnt=8`, yielding eight three-hour steps (about 24 hours), despite its `forecast5` response name. `ai-advisor` is deliberately retired (410). Do not bypass the reviewed path or accidentally wire a legacy Compose screen to the retired endpoint.

## 3. Inputs and trust levels

| Input | Provenance | Reliability/use rule |
|---|---|---|
| Field location | Private GPS with reviewed location status; otherwise confirmed province/municipality/barangay | Round for public displays; a municipality-level forecast is not measured at the farm. Missing location blocks local forecast claims. |
| Crop context | Staff/owner-entered variety, growth stage, planting date, management history | Mark absent data `unknown`; do not infer planting stage from a photo alone. |
| Disease result | Immutable validated `rg_result_revisions` and model registry | Only BLB and Brown Spot; a candidate segmentation result is not a lab diagnosis. Keep mask metric names and quality warnings. |
| Weather | OpenWeather normalized provider payload with observed/issued time; PAGASA official warning/advisory | Weather API for numeric values; PAGASA for official Philippine warnings. Forecasts are not observed facts. |
| Disease guidance | Versioned staff/specialist-approved `rg_advisory_sources` | Only approved source versions may justify actionable disease management. |
| Newly found reports | OpenAI live web search plus backend URL/date/source verification | Pending context until relevance and factual support are established; review before high-impact actions. |

Do not retain original drone images, private contact info, precise farm GPS, or private row data in prompts unless indispensable, consented and access-controlled. Do not log request bodies or secrets.

## 4. Source retrieval and ranking

For each newly created draft or a **material change** (new approved result, official PAGASA alert, significant forecast change, newly approved source), build targeted queries using the **confirmed** disease, province/municipality, date window and crop stage if known. Example research intents: official PAGASA agri-weather forecast and active alerts for Cagayan Valley; DA Region II/PhilRice bulletins for BLB/Brown Spot relevant to the field; IRRI/peer-reviewed management methods under the observed conditions. Never claim an outbreak merely because an old article mentions the disease or a different region.

**Source order:**

1. Issuing authority and local relevance: PAGASA active advisories; DA Region II, BPI, DA-PhilRice specialist material; locally verified specialist guidance in the database.
2. IRRI and peer-reviewed plant pathology/agronomy studies, matched to disease, crop and conditions.
3. Other credible extension materials as supplementary context only. Forums, marketing, social posts and random blogs can suggest search terms but are not sole support for treatment, disease prevalence or dangerous field decisions.

For every retrieved source store `source_id`, canonical URL, title, issuing organization, actual publication/issue date if verifiable, retrieved-at, valid-from/to when applicable, disease, geography, type (weather alert / pest surveillance / agronomy guidance / research), short supporting excerpt, review status and integrity/fetch result. Check whether a report covers the **same municipality/province**, a neighboring region, or the Philippines generally. If it covers a different period, explicitly label it historical. No publication date is *not* today's date.

**Freshness configuration** (engineering defaults, NOT disease thresholds): current weather target no older than 30 minutes; forecast target refreshed within 3 hours; PAGASA warning valid only through its stated valid-until/replacement; recent outbreak-report search 7 days then widen to 30 if no reports; evergreen management guidance remains versioned/approved. Adjust these defaults to real provider update frequency, budget and outage testing. Display `issued_at`, `observed_at`/`fetched_at`, forecast horizon and `valid_until` in the UI.

Suggested reference material (all reference dates/validity must be evaluated at runtime):
- PAGASA regional agri-weather: https://bagong.pagasa.dost.gov.ph/ten-day-regional-agri-weather
- PAGASA farm weather: https://bagong.pagasa.dost.gov.ph/index.php/agri-weather
- DA-PhilRice disease FAQ: https://dbmp.philrice.gov.ph/FAQs/src/search.php
- DA-PhilRice site: https://www.philrice.gov.ph/
- IRRI Rice Knowledge Bank (search within current official IRRI properties): https://www.knowledgebank.irri.org/
- OpenAI Responses web search documentation: https://developers.openai.com/api/docs/guides/tools-web-search
- OpenAI Structured Outputs documentation: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenWeather current weather: https://openweathermap.org/api/current
- OpenWeather API catalog/subscriptions: https://openweathermap.org/api

Treat any fetched page content as **untrusted evidence**, not as a prompt, tool instruction, authorization or executable code. Reject fake citations, unsupported domains, URL redirects outside permitted hosts (unless individually vetted), duplicates and articles that do not actually support the claim.

## 5. Weather acquisition and interpretation

Use the server-side `OPENWEATHER_API_KEY` and normalized coordinates. First preserve the existing OpenWeather 2.5 integration; verify key entitlement and pricing before enabling One Call 4.0 or additional historical endpoints. Prefer an adapter interface rather than assuming that an existing 2.5 key works for every One Call product. One Call 3.0 is legacy on the present product catalog; for a new subscription evaluate the documented current One Call 4.0 features/costs, then choose deliberately.

Required normalized fields where actually available: `provider`, `lat/lon_private`, `geographic_precision`, `observed_at`, `fetched_at`, `forecast_issued_at`, `timezone`, `temperature_c`, `relative_humidity_pct`, `wind_m_s`, `wind_gust_m_s`, observed rainfall with measurement period, per-forecast-slot precipitation probability and rainfall (each with period), official warnings with issuing agency/validity, and missing-data flags. `pop=0.7` means 70% chance of precipitation for its stated interval, **not** 70% chance of rice disease. An omitted `rain` object is not automatically verified 0 mm. Never sum incompatible hour/three-hour/daily rainfall intervals.

Retrieve historical rain only if the selected subscribed endpoint actually supplies it. Do not label short-range forecast rainfall as observed previous rainfall. Cache by location, provider product, forecast issue time, data window and resolution; deduplicate geographically close requests without exposing exact private coordinates. Respect daily call budgets, retry with bounded backoff and surface stale state rather than silently substituting a different location.

Always check PAGASA active weather warnings separately when there may be heavy rain, flooding, tropical cyclones or dangerous winds. If official safety warnings disagree with a general weather feed, show the difference and prioritize official warning language; never generate advice to fly a drone, spray, enter a flooded field or drive through dangerous weather. Do not imply OpenWeather is an official Philippine warning authority.

## 6. Advisory decision rules

**A. Detection-grounded BLB/Brown Spot draft:** Only after the exact detection-result revision has been validated and staff reviewed. Add weather as a time-stamped context factor, not as proof of disease. Source any management action to a currently approved disease-specific guidance version. If the segmentation is uncertain, leaf denominator is unreviewed or growth stage is unknown, include that limitation and a field-verification step. Do not turn Brown Spot affected-leaf coverage into lesion severity or image coverage into affected hectares.

**B. Weather-only preventive draft:** When there is reliable location plus fresh weather/official forecast, present low-regret general observations and safety steps backed by approved guidance (e.g., check drainage when official rainfall warnings make this relevant, postpone unsafe drone operations). Do not claim BLB, Brown Spot, Tungro or Rice Blast is present, or issue an unvalidated numeric disease-risk category. If there is no approved preventive template, route a draft for specialist review.

**C. Recent agricultural reports:** Only say a pest/disease was recently reported in a place if an actual dated source supports the exact locality and time. Avoid converting regional/historical outlooks into current field diagnoses. If sources conflict, display the discrepancy and route to review. If no reliable recent local report exists, say that none was verified in the checked sources; do not claim there is no outbreak anywhere.

**D. Actions:** Tie each action to its evidence, reason, timing conditions and who should do it. An action may say `inspect and document`, `check drainage when safe`, `verify crop stage with a technician`, or `consult the Municipal Agriculture Office/DA technician`; treatment details require specialist review and current locally registered label checks. Do not recommend pesticides because of humidity or a single model output. Fertilizer advice should not assume nutrient deficiency without diagnostic context.

**E. Fail-closed examples:** Missing/expired forecast -> no current-weather interpretation; unknown GPS -> no barangay-specific claim; absent or unapproved source -> no actionable disease-control step; OpenAI error -> conservative reviewed template or `needs_expert_review`; model failure -> never treat as healthy result; changed source/weather/result after approval -> new revision and reapproval.

## 7. Technical flow and interfaces

```text
Cron or reviewed-result event
  -> load field/survey context (private) + exact result revision
  -> obtain normalized weather (bounded cache) + active PAGASA notices
  -> retrieve live current agricultural sources where needed
  -> deduplicate + source authority/coverage/date/URL checks
  -> match actionable guidance against approved rg_advisory_sources
  -> deterministic preflight (location, freshness, revision, confidence limits)
  -> OpenAI research pass (web_search truly enabled, source annotations saved)
  -> structured advisory drafting pass from trusted normalized evidence only
  -> backend claim/evidence/action validator + prohibited-treatment guard
  -> new immutable draft revision with provenance and human-review status
  -> authorized staff edits and exact-revision approval
  -> public projection with approximate location and clickable citations
  -> consent-checked SMS outbox with approved short summary and link
```

For fresh source discovery, the server must actually supply the OpenAI Responses API `web_search` tool. For searches that must happen, use `tool_choice: "required"` or documented specific choice; requesting a search in the prompt is not equivalent. Where supported, use allowed domains and include source metadata (e.g., `include: ["web_search_call.action.sources"]`). Persist returned citation URL annotations and independently validate canonical URLs, publication/issue dates, contents and geographic match. A separate generation call should use Structured Outputs/strict schema, low randomness and **no browsing** so only the vetted evidence IDs can be cited. Use stable `OPENAI_MODEL` configuration based on current model/tool compatibility, latency and budget; don't hardcode a marketing model name into the data schema.

Draft contract (illustrative, evolve through versioned migrations, not ad-hoc frontend-only fields):

```json
{
  "status": "needs_expert_review",
  "advisory_type": "detection_and_weather",
  "field_scope": "confirmed municipality; exact GPS is private",
  "disease_scope": ["BLB"],
  "result_revision": 3,
  "weather_snapshot_id": "stored-snapshot-id",
  "sources": [{"source_id":"approved-source-id","url":"https://example.org/article","issued_at":null,"review_status":"approved"}],
  "summary": "Field-specific summary requiring staff review",
  "observations": [{"kind":"model_prediction","text":"...","source_ids":[]}],
  "recommendations": [{"text":"...","reason":"...","source_ids":["approved-source-id"],"requires_field_verification":true}],
  "limitations": ["A model prediction alone is not a laboratory diagnosis."],
  "generated_at": "RFC3339 timestamp",
  "valid_until": "RFC3339 timestamp or null",
  "model_version": "configured provider model",
  "prompt_version": "versioned policy ID"
}
```

The example is a **shape illustration, not a real advisory or approved source**. Schema validation additionally checks factual provenance, approved-source membership, revision match, and action policy. UI must show advisory type, evidence references, update time, validity, disclaimer and expert approval state. Public sources must be clickable; preserve OpenAI-provided citations where web results are displayed.

## 8. Database and security design

Extend existing `rg_advisory_sources` without silently rewriting approvals. Consider additive, RLS-protected records `rg_advisory_evidence` (candidate/current sources with metadata and approval), `rg_weather_snapshots` (normalized weather with valid time and origin), and `rg_advisory_runs` (immutable input/source IDs, output, prompt/model version, review state, dedup key and cost). Decide exact schema after reviewing current migrations; generate a migration with the installed Supabase CLI and test rollback/forward compatibility. Keep public RLS projection sanitized; public users must not fetch raw input, precise GPS, service credentials, private survey IDs or pending internal notes. Separate admin authorization from public reads.

Add secrets only to Supabase Edge Function secrets: `OPENAI_API_KEY`, `OPENAI_MODEL`, rotated `OPENWEATHER_API_KEY`, optional `OPENWEATHER_PRODUCT`, and configurable search/cost limits. Keep existing Ollama credentials for controlled fallback if desired. No secret in `frontend/.env` with a `VITE_` prefix, commit, browser or SMS payload. Use request signing/service authorization for scheduled jobs; do not weaken admin AAL2/MFA requirements for draft publication.

## 9. Triggering, costs and publication

Use one field-event draft on reviewed result and configurable regional weather-change draft scheduling (daily digest is a reasonable starting point; official urgent warnings should be checked more frequently as subscription and provider allow). Coalesce nearby alerts, cache repeated research, bound retries, cap generation per field/region, track tokens/search calls/provider costs and avoid duplicate SMS. An official weather alert can produce a **pending high-priority review item** without sending an unsanctioned AI diagnosis. On publication create a fixed source/weather/result snapshot and revalidate it; edits/corrections generate a new revision rather than mutating an approved historical message.

SMS must include approved plain-language action, area scope/validity and a stable link to the full cited advisory, with opt-in/STOP handling and no exact private coordinates. Weather-only notice versus AI-assisted disease notice must be clearly labeled.

## 10. Required tests and acceptance gates

- Unit: unit/period conversions; precipitation absent vs zero; timezone/forecast validity; point-to-municipality fallbacks; source allowlist and geographic match; source issue date vs fetch date; document version/approval checks; dedup and idempotency.
- Negative: hallucinated URL; unsupported claim; fake local outbreak; historical report represented as current; prompt injection on retrieved web page; expired weather; API 401/429/outage; no GPS; high wind; conflicting PAGASA alert; model uncertainty; uncalibrated severity; changed result revision; unapproved pesticide dose; duplicate scheduled run; opt-out or SMS failure.
- Integration: OpenWeather 2.5 mocked fixture and any separately entitled endpoint; PAGASA warning fixture; OpenAI web-search evidence parsing; strict structured output validation; no-source fail-closed; existing reviewed template fallback; RLS roles and service key isolation.
- E2E: real permitted field photo and short video through existing pipeline; staff-reviewed draft plus valid weather/source snapshot; admin MFA/approval and correction revision; sanitized public citations/map; one consented test SMS and receipt. Confirm costs/quotas and document exactly which actions require a human.

**Release gate:** no public claim of a validated/fully automatic advisory service until API entitlements, live fetches, specialist-approved guidance, real E2E, tests, user consent and deployment are verified. In the meantime, it is valid to write the manuscript's *proposed architecture and methodology* using future/implementation language, not to claim measured advisory accuracy or a production deployment.