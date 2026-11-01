// Automation after inference: severity -> place name -> public media -> Ollama advisory ->
// provisional publication -> SMS. Runs again in "verify" mode after a specialist decides.
// Triggered by worker-callback, by its own short retry kick and by a 1-minute cron sweeper (CRON_SECRET bearer).
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { awsSettings, signedAwsPost } from "../_shared/awsSigV4.ts";
import { computeSeverity, photosFromManifest, type Disease, type SeverityDetail } from "../_shared/autoSeverity.ts";
import { generateAdvisory, type AdvisoryResult, type Source } from "../_shared/ollamaAdvisory.ts";
import { normalizeWeatherContext } from "../_shared/weatherContext.ts";
import { autoSmsText, correctionSmsText, retractionSmsText, templateAdvisory } from "../_shared/autoText.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const origin = Deno.env.get("APP_ORIGIN") || "https://riceguardai.dev";
const OLLAMA_KEY = Deno.env.get("OLLAMA_API_KEY") || "";
const OLLAMA_URL = Deno.env.get("OLLAMA_BASE_URL") || "https://ollama.com/api";
const OLLAMA_MODEL = Deno.env.get("AUTO_ADVISORY_MODEL") || "gemma4:31b";
const MAX_ATTEMPTS = 6;
const MAX_PUBLIC_PHOTOS = 6;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const must = <T>(result: { data: T; error: { message: string } | null }) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

type Survey = Record<string, any>;
type Asset = Record<string, any>;

async function step(survey: Survey, name: string, status: "running" | "done" | "skipped" | "failed", detail: Record<string, unknown> = {}) {
  await db.from("rg_pipeline_steps").insert({ survey_id: survey.id, step: name, status, detail, attempt: survey.auto_attempts });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry a transient network or storage step (for example a storage 502 HTML page) before failing the run. */
async function withRetry<T>(work: () => Promise<T>, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= tries) throw error;
      await sleep(1_500 * attempt);
    }
  }
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

async function resolvePlace(survey: Survey, assets: Asset[]) {
  let { lat, lng } = survey;
  let source = survey.location_source || (lat != null ? "manual_pin" : "none");
  const gps = assets.filter((a) => a.kind === "image" && ["exif", "dji_xmp"].includes(a.location?.source));
  if ((lat == null || lng == null) && gps.length) {
    lat = median(gps.map((a) => Number(a.location.lat)));
    lng = median(gps.map((a) => Number(a.location.lng)));
    source = "exif_median";
  }
  if (lat == null || lng == null) return { lat: null, lng: null, place: { method: "none" }, label: survey.location, source: "none" };
  const place = must(await db.rpc("rg_reverse_geocode", { p_lat: lat, p_lng: lng })) as Record<string, any>;
  const label = place?.label || survey.location;
  must(await db.from("rg_surveys").update({ lat, lng, place, location: label, location_source: source,
    location_status: "verified", stage_updated_at: new Date().toISOString() }).eq("id", survey.id));
  return { lat, lng, place, label, source };
}

async function signedLinks(job: Record<string, any>, paths: string[]) {
  const links: Record<string, string> = {};
  for (let offset = 0; offset < paths.length; offset += 40) {
    Object.assign(links, await withRetry(async () => {
      const response = await signedAwsPost(JSON.stringify({ action: "signed-pinned-review", job_id: job.id, run_id: job.run_id,
        paths: paths.slice(offset, offset + 40) }), awsSettings());
      if (!response.ok) throw new Error("Private result signing is unavailable");
      return await response.json();
    }));
  }
  return links;
}

/** Copy web-sized original, combined and per-disease layers to the public bucket. */
async function publishMedia(job: Record<string, any>, survey: Survey, revision: number, ordered: Array<{ asset: Asset; diseases: Disease[] }>,
  allCounted: boolean) {
  const wanted: Array<[string, string, string]> = [];
  for (const { asset, diseases } of ordered) {
    const paths = asset.review_paths || {};
    wanted.push([asset.source_asset_id, "web_original", paths.web_original], [asset.source_asset_id, "web_combined", paths.web_combined]);
    for (const disease of diseases) wanted.push([asset.source_asset_id, `layer_${disease}`, paths[`layer_${disease}`]]);
  }
  if (wanted.some(([, , path]) => typeof path !== "string")) throw new Error("Result has no web-sized media (older model run)");
  const links = await signedLinks(job, wanted.map(([, , path]) => path));
  const stored: Record<string, string> = {};
  await Promise.all(wanted.map(async ([assetId, variant, path]) => {
    const bytes = await withRetry(async () => {
      const response = await fetch(links[path], { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Private media download failed (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    });
    const png = path.endsWith(".png");
    const signatureOk = png ? bytes[0] === 0x89 && bytes[1] === 0x50 : bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!signatureOk || bytes.length > 15_000_000) throw new Error("Public media failed verification");
    const target = `${survey.id}/${job.id}/auto-r${revision}/${assetId}-${variant.toLowerCase().replace(/[ _]/g, "-")}.${png ? "png" : "jpg"}`;
    await withRetry(async () => {
      const upload = await db.storage.from("rg-public-previews").upload(target, bytes,
        { contentType: png ? "image/png" : "image/jpeg", upsert: true, cacheControl: "31536000" });
      if (upload.error) throw new Error(`Public media upload failed: ${upload.error.message}`);
    });
    stored[`${assetId}|${variant}`] = db.storage.from("rg-public-previews").getPublicUrl(target).data.publicUrl;
  }));
  return ordered.map(({ asset, diseases }, index) => {
    const web = (job.result_manifest.media as Array<Record<string, any>>).find((m) =>
      m.source_asset_id === asset.source_asset_id && m.variant === "web_original");
    const original = stored[`${asset.source_asset_id}|web_original`];
    return {
      type: "image", url: allCounted ? stored[`${asset.source_asset_id}|web_combined`] : original, original_url: original,
      layers: Object.fromEntries(diseases.map((d) => [d, stored[`${asset.source_asset_id}|layer_${d}`]])),
      width: web?.width ?? asset.width, height: web?.height ?? asset.height, source_asset_id: asset.source_asset_id,
      photo_number: index + 1, diseases, alt: `Field photo ${index + 1} with ${diseases.join(" and ")} marked`,
    };
  });
}

async function nearbyWeather(lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return null;
  try {
    const response = await fetch(`${url}/functions/v1/weather?lat=${lat.toFixed(2)}&lng=${lng.toFixed(2)}`, {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey }, signal: AbortSignal.timeout(10_000) });
    const context = response.ok ? normalizeWeatherContext(await response.json(), Date.now()) : null;
    return context ? { ...context, point: { lat: Number(lat.toFixed(2)), lng: Number(lng.toFixed(2)) } } : null;
  } catch { return null; }
}

async function imageBase64(link: string) {
  const response = await fetch(link, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32_768) binary += String.fromCharCode(...bytes.subarray(i, i + 32_768));
  return btoa(binary);
}

async function writeAdvisory(survey: Survey, diseases: Disease[], severity: SeverityDetail, place: string,
  lat: number | null, lng: number | null, media: Array<Record<string, any>>) {
  const approved = must(await db.from("rg_advisory_sources").select("title,source_reference,guidance,disease")
    .in("disease", diseases).eq("active", true)) as Array<{ title: string; source_reference: string; guidance: any; disease: string }>;
  const facts = {
    diseases, overall_severity: severity.overall, photos: severity.photos, place,
    severity: Object.fromEntries(Object.entries(severity.diseases).map(([d, s]) => [d, {
      percent: s!.percent, ses_score: s!.ses_score, category: s!.category, photo_number: s!.photo_number, affected_photos: s!.affected_photos }])),
    crop_stage: survey.crop_stage && survey.crop_stage !== "unknown" ? survey.crop_stage : null,
    field_conditions: survey.field_conditions || [], weather: await nearbyWeather(lat, lng),
  };
  if (OLLAMA_KEY) {
    try {
      const images = (await Promise.all([media[0]?.original_url, media[0]?.url].filter(Boolean).map(imageBase64)))
        .filter((item): item is string => Boolean(item));
      return await generateAdvisory({ base: OLLAMA_URL, key: OLLAMA_KEY, model: OLLAMA_MODEL, facts, images,
        approved: approved.map((a) => ({ title: a.title, reference: a.source_reference, guidance: a.guidance })) });
    } catch (error) {
      await step(survey, "advisory_llm", "failed", { error: String(error instanceof Error ? error.message : error).slice(0, 300) });
      if (survey.auto_attempts < 3) throw error; // let the sweeper retry the model before falling back
    }
  }
  return templateAdvisory(facts, approved);
}

function sourcesForPost(advisory: AdvisoryResult): Source[] {
  return advisory.sources.map(({ n, title, url: link, publisher, approved }) => ({ n, title, url: link, publisher, excerpt: "", approved }));
}

async function run(survey: Survey) {
  const job = must(await db.from("rg_processing_jobs").select("id,run_id,status,result_manifest")
    .eq("survey_id", survey.id).eq("provider", "kaggle_yolo26").in("status", ["Needs review", "Reviewed"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle()) as Record<string, any> | null;
  if (!job?.result_manifest) throw new Error("No completed result for this survey");
  const assets = (job.result_manifest.assets || []) as Asset[];
  const bulletin = must(await db.from("rg_bulletins").select("*").eq("survey_id", survey.id)
    .eq("result_revision", survey.active_result_revision).is("archived_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()) as Record<string, any> | null;
  const verify = survey.auto_mode === "verify";
  const reviews = verify ? must(await db.from("rg_finding_reviews").select("source_asset_id,disease,decision")
    .eq("job_id", job.id)) as Array<Record<string, any>> : [];
  const detected = (assetId: string, disease: Disease) => assets.some((a) => a.source_asset_id === assetId &&
    (a.diseases || []).some((f: any) => f.disease === disease && f.status === "detected"));
  const counted = (assetId: string, disease: Disease) => detected(assetId, disease) &&
    (!verify || reviews.some((r) => r.source_asset_id === assetId && r.disease === disease && r.decision === "accepted"));
  const allCounted = assets.every((a) => (a.diseases || []).every((f: any) => f.status !== "detected" || counted(a.source_asset_id, f.disease)));

  if (!bulletin) {
    await step(survey, "no_disease", "done", { photos: assets.length });
    return;
  }
  // Specialist confirmed everything that was already published: just flip the badge.
  if (verify && allCounted && bulletin.status === "published" && bulletin.verification_status === "unverified") {
    must(await db.rpc("rg_mark_verified", { p_bulletin: bulletin.id, p_actor: survey.reviewed_by }));
    await step(survey, "verified", "done", {});
    return;
  }

  const photos = photosFromManifest(job.result_manifest, counted);
  const severity = computeSeverity(photos);
  if (!severity) {
    if (verify && bulletin.status === "published") {
      const retraction = must(await db.rpc("rg_auto_retract", { p_bulletin: bulletin.id,
        p_sms_text: retractionSmsText(bulletin.location), p_actor: survey.reviewed_by }));
      await step(survey, "retracted", "done", retraction as Record<string, unknown>);
    } else {
      await step(survey, "no_disease", "done", { reason: verify ? "all findings rejected" : "no measurable lesion" });
    }
    return;
  }
  const diseases = (Object.keys(severity.diseases) as Disease[]);
  must(await db.from("rg_surveys").update({ severity: severity.overall, severity_detail: severity }).eq("id", survey.id));
  await step(survey, "severity", "done", { overall: severity.overall, diseases: severity.diseases });

  const where = await resolvePlace(survey, assets);
  await step(survey, "location", "done", { label: where.label, method: where.place?.method, source: where.source });

  const share = (a: Asset) => Math.max(...diseases.map((d) => counted(a.source_asset_id, d)
    ? Number(a.measurements?.lesion_pixels?.[d] || 0) / Math.max(1, Number(a.measurements?.plant_pixels || 0)) : 0));
  const representative = new Set(Object.values(severity.diseases).map((s) => s!.representative_asset_id));
  const ordered = assets.filter((a) => a.kind === "image" && diseases.some((d) => counted(a.source_asset_id, d)))
    .sort((a, b) => Number(representative.has(b.source_asset_id)) - Number(representative.has(a.source_asset_id)) || share(b) - share(a))
    .slice(0, MAX_PUBLIC_PHOTOS)
    .map((asset) => ({ asset, diseases: diseases.filter((d) => counted(asset.source_asset_id, d)) }));
  const media = await publishMedia(job, survey, survey.active_result_revision, ordered, allCounted);
  await step(survey, "media", "done", { photos: media.length });

  const advisory = await writeAdvisory(survey, diseases, severity, where.label, where.lat, where.lng, media);
  await step(survey, "advisory", "done", { mode: advisory.mode, model: advisory.model, queries: advisory.queries,
    sources: advisory.sources.map((s) => s.url), observations: advisory.observations });

  const changed = verify && bulletin.status === "published";
  const slugUrl = `${origin}/advisories/${bulletin.slug}`;
  const payload = {
    title: advisory.title || bulletin.title, body: advisory.summary,
    action: advisory.actions.map((item, i) => `${i + 1}. ${item}`).join("\n"),
    limitations: advisory.watch_for.length ? `Bantayan: ${advisory.watch_for.join(" ")}` : "",
    diseases, severity: severity.overall, severity_detail: severity, advisory_sources: sourcesForPost(advisory),
    place: where.place, location: where.label, public_media: media,
    verification_status: verify ? (changed ? "corrected" : "verified") : "unverified",
    verified_by: verify ? survey.reviewed_by : null,
    correction_note: changed ? "Inayos ng specialist ang mga nakitang sakit; na-update ang severity at payo." : "",
    send_sms: true, campaign_kind: changed ? "correction" : "advisory",
    sms_text: changed ? correctionSmsText(diseases, severity, where.label, slugUrl)
      : autoSmsText(diseases, severity, where.label, advisory.actions, slugUrl),
  };
  const published = must(await db.rpc("rg_auto_publish", { p_bulletin: bulletin.id, p_payload: payload }));
  await step(survey, "published", "done", published as Record<string, unknown>);
}

async function processSurvey(survey: Survey) {
  try {
    await step(survey, survey.auto_mode === "verify" ? "verify_start" : "start", "running", { attempt: survey.auto_attempts });
    await run(survey);
    await db.from("rg_surveys").update({ auto_status: "done", auto_next_at: null, auto_error: null }).eq("id", survey.id);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    const failed = survey.auto_attempts >= MAX_ATTEMPTS;
    // 15 s, 30 s, 1 min, 2 min, 4 min: a transient fault clears without waiting for the sweeper.
    const delay = 15_000 * 2 ** (survey.auto_attempts - 1);
    await db.from("rg_surveys").update({ auto_status: failed ? "failed" : "retry", auto_error: message,
      auto_next_at: failed ? null : new Date(Date.now() + delay).toISOString() }).eq("id", survey.id);
    await step(survey, "error", "failed", { error: message, will_retry: !failed, retry_in_seconds: failed ? null : delay / 1000 });
    if (!failed && delay <= 60_000) {
      await sleep(delay + 1_000);
      await fetch(`${url}/functions/v1/auto-pipeline`, { method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("CRON_SECRET")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ survey_id: survey.id }), signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    }
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "Unauthorized" }, 401);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await req.json().catch(() => ({}));
  const surveyId = typeof body.survey_id === "string" && /^[0-9a-f-]{36}$/i.test(body.survey_id) ? body.survey_id : null;
  const claimed = must(await db.rpc("rg_auto_claim", { p_survey: surveyId })) as Survey[];
  const work = (async () => { for (const survey of claimed || []) await processSurvey(survey); })();
  (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(work);
  return json({ claimed: (claimed || []).map((s) => s.id) }, 202);
});
