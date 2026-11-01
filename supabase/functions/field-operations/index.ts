import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { checkResult as check, requireResult } from "../_shared/databaseResult.ts";
import { awsSettings, signedAwsPost } from "../_shared/awsSigV4.ts";
import { ADVISORY_CANDIDATES, advisoryCandidate } from "../_shared/advisoryCandidates.ts";
import { publishGuidanceIsComplete } from "../_shared/advisoryEvidence.ts";
import { validateFieldSeverity } from "../_shared/fieldSeverity.ts";
import { validateSeverityReview } from "../_shared/reviewWorkflow.ts";
import { validateMediaSelection, validateVideoClipSelection, type SourceAsset } from "../_shared/mediaSelection.ts";
import { PINNED_KAGGLE_WORKFLOW_SHA256 } from "../_shared/pinnedResult.ts";
import { registerPingWebhook, smsGatewayHealth } from "../_shared/smsGatewayHealth.ts";
import { smsAdvisoryMessage } from "../_shared/advisoryPresentation.ts";
import { inferenceConfiguration } from "../_shared/systemReadiness.ts";
import { smsSystemTestAction } from "../_shared/smsSystemTestAction.ts";
import { gatewaySelection, isManilaQuietHour, nextManilaSixAm, smsSegments } from "../_shared/smsDelivery.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const origin = Deno.env.get("APP_ORIGIN") || "http://localhost:5173";
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
  "Cache-Control": "no-store",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
type ErrorCode =
  | "AUTH_REQUIRED"
  | "PHONE_VERIFICATION_REQUIRED"
  | "INVALID_LOCATION"
  | "CONTACT_CONFLICT"
  | "PILOT_LIMIT_REACHED"
  | "VALIDATION_ERROR";
const requiredText = (value: unknown, max = 500) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("Invalid required text");
  return value.trim();
};
const optionalText = (value: unknown, max = 500) => {
  if (value == null || value === "") return null;
  return requiredText(value, max);
};
const uuid = (value: unknown) => {
  const v = requiredText(value, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))
    throw new Error("Invalid identifier");
  return v;
};
const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
const assuranceLevel = (token: string) => {
  try {
    const part = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "="))).aal as string;
  } catch {
    return null;
  }
};

// Phone heartbeat (webhooks) or the SMS Gate cloud's lastSeen, whichever is newer.
async function smsGatewayStatus() {
  return (await smsGatewayHealth(db)).state;
}

let driveToken: { value: string; expires: number } | null = null;
async function googleAccessToken() {
  if (driveToken && driveToken.expires > Date.now() + 60_000) return driveToken.value;
  const clientId = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken)
    throw new Error("Google Drive application storage is not configured");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error("Google Drive authorization failed");
  const body = await response.json();
  driveToken = { value: body.access_token, expires: Date.now() + Number(body.expires_in || 3600) * 1000 };
  return driveToken.value;
}

async function startDriveUpload(input: {
  assetId: string;
  surveyId: string;
  filename: string;
  mime: string;
  bytes: number;
  checksum: string;
}) {
  const parent = Deno.env.get("GOOGLE_DRIVE_APP_FOLDER_ID");
  if (!parent) throw new Error("Google Drive application folder is not configured");
  const token = await googleAccessToken();
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mime,
        "X-Upload-Content-Length": String(input.bytes),
      },
      body: JSON.stringify({
        name: input.filename,
        parents: [parent],
        appProperties: {
          riceguard_asset_id: input.assetId,
          riceguard_survey_id: input.surveyId,
          client_sha256: input.checksum,
        },
      }),
    },
  );
  const uploadUrl = response.headers.get("location");
  if (!response.ok || !uploadUrl) {
    let reason = `HTTP ${response.status}`;
    try {
      const body = await response.json() as { error?: { errors?: Array<{ reason?: string }> } };
      reason = body.error?.errors?.[0]?.reason || reason;
    } catch {
      // Keep the status-only reason when Google does not return JSON.
    }
    throw new Error(`Private Drive upload session failed (${reason})`);
  }
  return uploadUrl;
}

type DriveFileMetadata = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  md5Checksum?: string;
  appProperties?: Record<string, string>;
  parents?: string[];
  createdTime?: string;
};

async function recoverUploadedDriveFile(asset: {
  id: string;
  survey_id: string;
  mime: string;
  bytes: number;
  md5_checksum: string;
}) {
  const parent = Deno.env.get("GOOGLE_DRIVE_APP_FOLDER_ID");
  if (!parent) throw new Error("Google Drive application folder is not configured");
  const token = await googleAccessToken();
  const query = [
    "trashed = false",
    `appProperties has { key='riceguard_asset_id' and value='${asset.id}' }`,
    `appProperties has { key='riceguard_survey_id' and value='${asset.survey_id}' }`,
  ].join(" and ");
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,mimeType,size,md5Checksum,appProperties,parents,createdTime)",
    orderBy: "createdTime desc",
    pageSize: "20",
    spaces: "drive",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Uploaded Drive file could not be recovered");
  const body = await response.json() as { files?: DriveFileMetadata[] };
  return (body.files || []).find((metadata) =>
    metadata.appProperties?.riceguard_asset_id === asset.id &&
    metadata.appProperties?.riceguard_survey_id === asset.survey_id &&
    metadata.parents?.includes(parent) &&
    Number(metadata.size) === Number(asset.bytes) &&
    metadata.mimeType === asset.mime &&
    String(metadata.md5Checksum || "").toLowerCase() === String(asset.md5_checksum).toLowerCase()
  ) || null;
}

async function replaceDriveUploadSession(asset: {
  id: string;
  survey_id: string;
  filename: string;
  mime: string;
  bytes: number;
  checksum: string;
}, userId: string) {
  const uploadUrl = await startDriveUpload({
    assetId: asset.id,
    surveyId: asset.survey_id,
    filename: asset.filename,
    mime: asset.mime,
    bytes: Number(asset.bytes),
    checksum: asset.checksum,
  });
  const existing = check(await db.from("rg_upload_sessions")
    .select("id").eq("asset_id", asset.id).maybeSingle());
  const values = {
    provider_session_url: uploadUrl,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    offset_bytes: 0,
    state: "active",
    created_by: userId,
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    check(await db.from("rg_upload_sessions").update(values).eq("id", existing.id));
  } else {
    check(await db.from("rg_upload_sessions").insert({
      id: crypto.randomUUID(),
      asset_id: asset.id,
      ...values,
    }));
  }
  check(await db.from("rg_assets").update({
    state: "Uploading",
    error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", asset.id));
  return uploadUrl;
}

// Kick the GPU dispatcher as soon as a job exists instead of waiting for its cron tick.
function startDispatch(kind: "kaggle-dispatch" | "aws-dispatch") {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return;
  const request = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${kind === "aws-dispatch" ? "aws-dispatcher" : "job-dispatcher"}`, {
    method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: "{}",
    signal: AbortSignal.timeout(50_000),
  }).catch(() => undefined);
  (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(request);
}

function startAutoPipeline(surveyId: string) {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return;
  const request = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/auto-pipeline`, {
    method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ survey_id: surveyId }), signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
  (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(request);
}

async function createJobIfReady(surveyId: string, recoveryAttemptId?: string) {
  const survey = requireResult(await db.from("rg_surveys").select("*").eq("id", surveyId).single());
  const assets = check(
    await db
      .from("rg_assets")
      .select("id,filename,mime,bytes,checksum,md5_checksum,width,height,duration_seconds,clip_start_seconds,clip_duration_seconds,clip_target_fps,linked_photo_asset_id,orientation,drive_file_id,capture_time,exif_lat,exif_lng,state")
      .eq("survey_id", surveyId)
      .order("id"),
  ) || [];
  if (assets.length !== survey.expected_assets || assets.some((asset) => asset.state !== "Verified"))
    return null;
  const provider = survey.inference_provider;
  if (provider === "kaggle")
    throw new Error("Legacy Kaggle inference is disabled until its worker uses both pinned YOLO26m-semantic specialists.");
  if (provider === "aws") validateMediaSelection(assets as SourceAsset[], "aws");
  if (provider === "kaggle_yolo26") validateMediaSelection(assets as SourceAsset[], "kaggle_yolo26");
  const manifest = {
    schema_version: "riceguard.batch.v1",
    survey_id: surveyId,
    captured_at: survey.captured_at,
    location_status: survey.location_status,
    execution_provider: provider,
    ...(provider === "kaggle_yolo26" ? {
      pinned_workflow_sha256: PINNED_KAGGLE_WORKFLOW_SHA256,
    } : {}),
    ...(recoveryAttemptId ? { recovery_attempt_id: recoveryAttemptId } : {}),
    assets,
  };
  const canonical = JSON.stringify(manifest);
  const manifestHash = await sha256(canonical);
  const runId = `rg-${surveyId.slice(0, 8)}-${manifestHash.slice(0, 12)}`;
  const placeholderToken = randomToken();
  const { data: job, error } = await db
    .from("rg_processing_jobs")
    .insert({
      survey_id: surveyId,
      run_id: runId,
      manifest,
      manifest_hash: manifestHash,
      provider,
      worker_token_hash: await sha256(placeholderToken),
      worker_token_expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    })
    .select("id,run_id,status")
    .single();
  if (error && !error.message.toLowerCase().includes("duplicate")) throw new Error(error.message);
  const resolved = job || requireResult(
    await db.from("rg_processing_jobs").select("id,run_id,status").eq("manifest_hash", manifestHash).single(),
  );
  check(await db.from("rg_surveys").update({
    status: "Queued",
    progress: 0,
    manifest_hash: manifestHash,
    stage_updated_at: new Date().toISOString(),
  }).eq("id", surveyId));
  check(await db.from("rg_outbox").upsert(
    { kind: provider === "aws" ? "aws-dispatch" : "kaggle-dispatch", entity_id: resolved.id, state: "pending", available_at: new Date().toISOString() },
    { onConflict: "kind,entity_id", ignoreDuplicates: true },
  ));
  startDispatch(provider === "aws" ? "aws-dispatch" : "kaggle-dispatch");
  return resolved;
}

async function stageV2PublicMedia(bulletin: Record<string, unknown>, provider: "aws" | "kaggle_yolo26") {
  const surveyId = String(bulletin.survey_id);
  const revision = Number(bulletin.result_revision);
  const { data: job, error: jobError } = await db.from("rg_processing_jobs")
    .select("id,run_id,result_manifest,status")
    .eq("survey_id", surveyId).eq("provider", provider).eq("status", "Reviewed")
    .order("created_at", { ascending: false }).limit(1).single();
  if (jobError || !job || job.result_manifest?.schema_version !== "riceguard.result.v2")
    throw new Error("The reviewed private result is unavailable");
  const { data: decisions, error: reviewError } = await db.from("rg_finding_reviews")
    .select("source_asset_id,disease,decision").eq("job_id", job.id);
  if (reviewError) throw new Error("Could not verify disease review decisions");
  const assets = job.result_manifest.assets as Array<Record<string, unknown>>;
  const chosen = assets.flatMap((asset) => {
    const assetId = String(asset.source_asset_id);
    const accepted = (decisions || []).filter((decision) =>
      decision.source_asset_id === assetId && decision.decision === "accepted" &&
      (asset.diseases as Array<Record<string, unknown>>).some((finding) =>
        finding.disease === decision.disease && finding.status === "detected"));
    if (!accepted.length) return [];
    if (asset.kind === "video") {
      const candidate = (job.result_manifest.media as Array<Record<string, unknown>>).find((media) =>
        media.source_asset_id === assetId && media.type === "video" &&
        media.variant === "publication_candidate" && media.sanitized === true);
      if (!candidate || typeof candidate.path !== "string")
        throw new Error("Approved 4K video publication candidate is missing");
      return [{ assetId, width: Number(asset.width), height: Number(asset.height),
        variant: "presentation", path: candidate.path, type: "video" }];
    }
    const variant = accepted.length === 2 ? "combined" : String(accepted[0].disease);
    const path = (asset.review_paths as Record<string, unknown>)?.[variant];
    if (typeof path !== "string") throw new Error("Approved review media is missing");
    return [{ assetId, width: Number(asset.width), height: Number(asset.height), variant, path, type: "image" }];
  });
  if (!chosen.some((item) => item.type === "image") || chosen.length > 11)
    throw new Error("At least one accepted photo is required as the bulletin cover");
  chosen.sort((a, b) => (a.type === b.type ? 0 : a.type === "image" ? -1 : 1));
  const signed = await signedAwsPost(JSON.stringify({ action: provider === "aws" ? "signed-review" : "signed-pinned-review", job_id: job.id,
    run_id: job.run_id, paths: chosen.map((item) => item.path) }), awsSettings());
  if (!signed.ok) throw new Error("Private approved media could not be signed");
  const links = await signed.json() as Record<string, string>;
  const publicMedia = [];
  for (const item of chosen) {
    const url = links[item.path];
    if (!url || !url.startsWith("https://")) throw new Error("Private review link is unavailable");
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    const size = Number(response.headers.get("content-length") || 0);
    if (!response.ok || size > 52_428_800) throw new Error("Approved media exceeds the 50 MB publication limit");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const isVideo = item.type === "video";
    const signatureOkay = isVideo
      ? String.fromCharCode(...bytes.slice(4, 8)) === "ftyp"
      : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!bytes.length || bytes.length > 52_428_800 || !signatureOkay)
      throw new Error("Approved public media failed signature verification");
    const extension = isVideo ? "mp4" : "jpg";
    const contentType = isVideo ? "video/mp4" : "image/jpeg";
    const path = `${surveyId}/${job.id}/approved-r${revision}/${item.assetId}-${item.variant.toLowerCase().replaceAll(" ", "-")}.${extension}`;
    const stored = await db.storage.from("rg-public-previews").upload(path, bytes, {
      contentType, upsert: true, cacheControl: "31536000",
    });
    if (stored.error) throw new Error("Approved photo could not be stored for publication");
    publicMedia.push({ url: db.storage.from("rg-public-previews").getPublicUrl(path).data.publicUrl,
      alt: `${item.variant} reviewed field assessment`, type: item.type, width: item.width,
      height: item.height, source_asset_id: item.assetId });
  }
  const saved = await db.from("rg_bulletins").update({ image: publicMedia[0].url,
    public_media: publicMedia, updated_at: new Date().toISOString() })
    .eq("id", bulletin.id).eq("status", "draft").eq("result_revision", revision);
  if (saved.error) throw new Error("Approved public media could not be attached to the draft");
}

async function stageLegacyPublicMedia(bulletin: Record<string, unknown>) {
  const surveyId = String(bulletin.survey_id);
  const { data: job, error: jobError } = await db.from("rg_processing_jobs")
    .select("id,result_manifest").eq("survey_id", surveyId).eq("provider", "kaggle")
    .order("created_at", { ascending: false }).limit(1).single();
  if (jobError || !job || job.result_manifest?.schema_version !== "riceguard.result.v1")
    throw new Error("The reviewed result is unavailable");
  const paths = job.result_manifest.preview_paths as Record<string, string> | undefined;
  if (!paths?.combined || paths.combined !== `${surveyId}/${job.id}/combined.webp`)
    throw new Error("A private photo preview is required before publication");
  const publicMedia = [];
  for (const [variant, mime, extension] of [
    ["combined", "image/webp", "webp"], ["video", "video/mp4", "mp4"],
  ]) {
    const sourcePath = paths[variant];
    if (!sourcePath) continue;
    const expected = variant === "video" ? `${surveyId}/${job.id}/review.mp4` : `${surveyId}/${job.id}/combined.webp`;
    if (sourcePath !== expected) throw new Error("Private preview path did not match the reviewed job");
    const downloaded = await db.storage.from("rg-review-previews").download(sourcePath);
    if (downloaded.error || !downloaded.data) throw new Error("Private review media could not be read");
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    if (!bytes.length || bytes.length > 52_428_800 || (variant === "combined" &&
      (String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" ||
        String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP")) ||
      (variant === "video" && String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp"))
      throw new Error("Approved preview failed media verification or exceeds 50 MB");
    const target = `${surveyId}/${job.id}/approved-r${bulletin.result_revision}/${variant}.${extension}`;
    const stored = await db.storage.from("rg-public-previews").upload(target, bytes, {
      contentType: mime, upsert: true, cacheControl: "31536000",
    });
    if (stored.error) throw new Error("Approved preview could not be stored for publication");
    publicMedia.push({ url: db.storage.from("rg-public-previews").getPublicUrl(target).data.publicUrl,
      alt: variant === "video" ? "Reviewed field assessment video" : "Reviewed field assessment image",
      type: variant === "video" ? "video" : "image" });
  }
  const saved = await db.from("rg_bulletins").update({ image: publicMedia[0].url,
    public_media: publicMedia, updated_at: new Date().toISOString() })
    .eq("id", bulletin.id).eq("status", "draft");
  if (saved.error) throw new Error("Approved public media could not be attached to the draft");
}

Deno.serve(async (req) => {
  const requestId = req.headers.get("x-request-id")?.slice(0, 100) || crypto.randomUUID();
  const failure = (message: string, status = 400, code: ErrorCode = "VALIDATION_ERROR") =>
    reply({ error: message, code, request_id: requestId }, status);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return failure("Method not allowed", 405);
  if (req.headers.get("origin") && req.headers.get("origin") !== origin)
    return failure("Origin not allowed", 403);
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return failure("Authentication required", 401, "AUTH_REQUIRED");
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return failure("Session expired or invalid", 401, "AUTH_REQUIRED");

  let requestAction = "";
  try {
    const raw = await req.text();
    if (raw.length > 120_000) return failure("Request too large", 413);
    const { action, payload: p = {} } = JSON.parse(raw);
    requestAction = String(action || "");
    const user = auth.user;

    if (action === "registration-status") {
      const contact = check(await db
        .from("rg_contacts")
        .select("id,name,consent,verified,barangay_code")
        .eq("account_id", user.id)
        .maybeSingle());
      const farm = contact?.id
        ? check(await db.from("rg_farms").select("id").eq("contact_id", contact.id).limit(1).maybeSingle())
        : null;
      const registered = Boolean(contact?.id && contact.verified && contact.barangay_code);
      const consent = Boolean(contact?.consent);
      return reply({
        registered,
        consent,
        alert_ready: Boolean(registered && consent && farm?.id),
        barangay_code: contact?.barangay_code || undefined,
        name: contact?.name || undefined,
      });
    }

    if (action === "register-contact") {
      if (!user.phone_confirmed_at || !user.phone)
        return failure("Verified phone required", 403, "PHONE_VERIFICATION_REQUIRED");
      if (p.consent !== true)
        return failure("SMS consent is required for registration", 400, "VALIDATION_ERROR");
      const phone = user.phone.startsWith("+") ? user.phone : `+${user.phone}`;
      const contactId = check(await db.rpc("rg_update_contact", {
        p_user: user.id,
        p_name: requiredText(p.name, 120),
        p_barangay: requiredText(p.barangay_code, 12),
        p_consent: p.consent === true,
        p_phone: phone,
      }));
      return reply({ contact_id: contactId, registered: true });
    }
    if (action === "opt-out") {
      const contact = requireResult(await db.from("rg_contacts").select("id").eq("account_id", user.id).single());
      check(await db.from("rg_contacts").update({ consent: false }).eq("id", contact.id));
      check(await db.from("rg_consent_events").insert({
        contact_id: contact.id,
        consent: false,
        source: "verified-preferences",
        actor_id: user.id,
      }));
      check(await db.from("rg_recipients").update({ status: "suppressed" }).eq("contact_id", contact.id).eq("status", "queued"));
      return reply({ stopped: true });
    }

    const profile = check(await db.from("profiles").select("role,is_active").eq("id", user.id).single());
    if (!profile || profile.role !== "admin" || !profile.is_active)
      return failure("Active admin role required", 403, "AUTH_REQUIRED");
    if (assuranceLevel(token) !== "aal2") return failure("Administrator MFA verification required", 403, "AUTH_REQUIRED");

    if (action === "advisory-guidance") {
      const approved = check(await db.from("rg_advisory_sources")
        .select("id,disease,title,version,source_reference,approved_at,active")
        .order("approved_at", { ascending: false }));
      return reply({ candidates: ADVISORY_CANDIDATES, approved });
    }
    if (action === "approve-advisory-source") {
      if (p.confirmed !== true) throw new Error("Explicit specialist review confirmation is required");
      const candidate = advisoryCandidate(p.candidate_id);
      const specialistName = requiredText(p.specialist_name, 120);
      const reviewNote = requiredText(p.review_note, 500);
      if (reviewNote.length < 10 || specialistName.length < 2)
        throw new Error("A specialist name and specific review note are required");
      const sourceId = check(await db.rpc("rg_approve_advisory_source", {
        p_candidate_id: candidate.id, p_disease: candidate.disease, p_title: candidate.title,
        p_version: candidate.version, p_guidance: candidate.guidance,
        p_reference: candidate.reference, p_actor: user.id,
        p_specialist_name: specialistName, p_review_note: reviewNote,
      }));
      return reply({ source_id: sourceId });
    }

    if (action === "processing-status") {
      const [surveys, jobs, bulletins] = await Promise.all([
        db.from("rg_surveys").select("id,status,progress,active_result_revision,approved_result_revision,stage_updated_at").is("archived_at", null).order("created_at", { ascending: false }).limit(500),
        db.from("rg_processing_jobs").select("id,status,progress,rg_surveys!inner(archived_at)").is("rg_surveys.archived_at", null).order("created_at", { ascending: false }).limit(500),
        db.from("rg_bulletins").select("id,status,advisory_revision,updated_at").is("archived_at", null).order("created_at", { ascending: false }).limit(500),
      ]);
      return reply({ surveys: check(surveys), jobs: check(jobs), bulletins: check(bulletins) });
    }

    if (["sms-system-test-preview","sms-system-test-send","sms-system-test-status"].includes(action))
      return reply(await smsSystemTestAction(db,user.id,action,p,Deno.env,smsGatewayStatus));

    if (action === "system-readiness") {
      return reply({ inference: inferenceConfiguration({
        upload: Deno.env.get("PINNED_KAGGLE_UPLOAD_ENABLED") === "true",
        dispatch: Deno.env.get("PINNED_KAGGLE_DISPATCH_ENABLED") === "true",
        callback: Deno.env.get("PINNED_KAGGLE_CALLBACK_ENABLED") === "true",
        dispatcher: !!(Deno.env.get("KAGGLE_DISPATCH_URL") && Deno.env.get("KAGGLE_DISPATCH_SECRET")),
      }, PINNED_KAGGLE_WORKFLOW_SHA256) });
    }

    if (action === "snapshot") {
      const [surveys, bulletins, contacts, farms, campaigns, assets, jobs, models, smsStatus] = await Promise.all([
        db.from("rg_surveys").select("id,name,location,captured_at,camera,status,photos,expected_assets,severity,lat,lng,location_status,progress,stage_updated_at,active_result_revision,approved_result_revision,note,crop_stage,field_conditions,field_assessment,auto_status,auto_mode,auto_error,auto_attempts,place,severity_detail,location_source,created_at").is("archived_at", null).order("created_at", { ascending: false }).limit(500),
        db.from("rg_bulletins").select("id,survey_id,slug,title,location,disease,diseases,severity,severity_recommendation,body,action,limitations,advisory_source_ids,date,status,image,public_media,reviewer,sample,lat,lng,public_location_approved,location_review,context_review_required,media_approved,published_at,updated_at,revision,advisory_revision,result_revision,verification_status,verified_at,auto_generated,severity_detail,advisory_sources,place").is("archived_at", null).order("created_at", { ascending: false }).limit(500),
        db.from("rg_contacts").select("id,name,phone,location,consent,verified").limit(100),
        db.from("rg_farms").select("id,contact_id,geometry"),
        db.rpc("rg_sms_campaign_stats"),
        db.from("rg_assets").select("id,survey_id,filename,mime,bytes,state,preview_url,drive_file_id,checksum,width,height,duration_seconds,rg_surveys!inner(archived_at)").is("rg_surveys.archived_at", null).order("created_at", { ascending: false }).limit(1000),
        db.from("rg_processing_jobs").select("id,survey_id,status,progress,provider,kaggle_kernel_ref,aws_job_ref,run_id,error,result_manifest,created_at,updated_at,dispatched_at,started_at,completed_at,provider_state,provider_checked_at,rg_surveys!inner(archived_at)").is("rg_surveys.archived_at", null).order("created_at", { ascending: false }).limit(500),
        db.from("rg_model_registry").select("id,disease,version,architecture,encoder,input_size,overlap,threshold,minimum_component_pixels,active,validation_summary").order("disease"),
        smsGatewayHealth(db),
      ]);
      [surveys, bulletins, contacts, farms, campaigns, assets, jobs, models].forEach((r) => { if (r.error) throw new Error(r.error.message); });
      const farmRows = farms.data || [];
      const findingReviews = (jobs.data || []).length
        ? requireResult(await db.from("rg_finding_reviews").select("job_id,source_asset_id,disease,decision").in("job_id", (jobs.data || []).map(job => job.id)).limit(10000))
        : [];
      const jobRows = await Promise.all((jobs.data || []).map(async (job) => {
        const reviewUrls: Record<string, Record<string, string>> = {};
        if (["aws", "kaggle_yolo26"].includes(job.provider) &&
          job.result_manifest?.schema_version === "riceguard.result.v2") {
          const assets = job.result_manifest.assets || [];
          const candidates=(job.result_manifest.media || []).filter((m:Record<string,unknown>)=>m.type==="video" && m.variant==="publication_candidate" && m.sanitized===true && typeof m.path==="string");
          const paths = [...new Set([...assets.flatMap((asset: Record<string, unknown>) => Object.values(asset.review_paths || {})),...candidates.map((m:Record<string,unknown>)=>m.path)])];
          if (paths.length && paths.length <= (job.provider === "aws" ? 17 : 45)) {
            try {
              // Keep the existing signer request limits; the sanitized video
              // candidate may add one path to a maximum-size image gallery.
              const urls:Record<string,string>={};const chunk=job.provider==="aws" ? 16 : 44;
              for(let offset=0;offset<paths.length;offset+=chunk){
                const signed = await signedAwsPost(JSON.stringify({ action: job.provider === "aws" ? "signed-review" : "signed-pinned-review", job_id: job.id,
                  run_id: job.run_id, paths:paths.slice(offset,offset+chunk) }), awsSettings());
                if(!signed.ok)throw new Error("Private review signing unavailable");
                Object.assign(urls,await signed.json());
              }
              {
                for (const asset of assets) {
                  reviewUrls[asset.source_asset_id] = {};
                  for (const [variant, path] of Object.entries(asset.review_paths || {})) {
                    if (typeof path === "string" && typeof urls[path] === "string") reviewUrls[asset.source_asset_id][variant] = urls[path];
                  }
                  const candidate=candidates.find((m:Record<string,unknown>)=>m.source_asset_id===asset.source_asset_id);
                  if(candidate && typeof urls[candidate.path]==="string")reviewUrls[asset.source_asset_id].publication=urls[candidate.path];
                }
              }
            } catch {
              // Keep the job visible to staff if temporary signing is down;
              // never expose a private S3 object key as a browser URL.
            }
          }
          return { ...job, review_urls: reviewUrls, finding_reviews: findingReviews.filter(row => row.job_id === job.id) };
        }
        for (const asset of job.result_manifest?.assets || []) {
          const paths = asset.review_paths || {};
          reviewUrls[asset.source_asset_id] = {};
          for (const [variant, path] of Object.entries(paths)) {
            const signed = await db.storage.from("rg-review-previews").createSignedUrl(String(path), 3600);
            if (!signed.error) reviewUrls[asset.source_asset_id][variant] = signed.data.signedUrl;
          }
        }
        return { ...job, review_urls: reviewUrls, finding_reviews: findingReviews.filter(row => row.job_id === job.id) };
      }));
      const steps = requireResult(await db.from("rg_pipeline_steps").select("id,survey_id,step,status,detail,attempt,created_at")
        .order("created_at", { ascending: false }).limit(400));
      return reply({
        surveys: surveys.data || [],
        pipeline_steps: steps || [],
        bulletins: bulletins.data || [],
        contacts: (contacts.data || []).map((contact) => ({
          ...contact,
          farms: farmRows.filter((farm) => farm.contact_id === contact.id).flatMap((farm) => {
            const coordinates = farm.geometry?.type === "Point" ? farm.geometry.coordinates : null;
            return coordinates ? [{ lng: coordinates[0], lat: coordinates[1] }] : [];
          }),
        })),
        campaigns: campaigns.data || [],
        assets: (assets.data || []).map((asset) => ({ ...asset, name: asset.filename, status: asset.state })),
        jobs: jobRows,
        models: models.data || [],
        sms_health: smsStatus,
        providers: {
          drive: Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN") ? "connected" : "configuration_required",
          kaggle: Deno.env.get("KAGGLE_DISPATCH_URL") && Deno.env.get("KAGGLE_DISPATCH_SECRET") ? "connected" : "configuration_required",
          sms: smsStatus.state,
          advisory: Deno.env.get("OLLAMA_API_KEY") ? "connected" : "configuration_required",
        },
      });
    }

    if (action === "create-survey") {
      const surveyId = p.id ? uuid(p.id) : crypto.randomUUID();
      if (p.inference_provider != null && !["aws", "kaggle", "kaggle_yolo26"].includes(String(p.inference_provider)))
        throw new Error("Unsupported processing provider");
      const provider = p.inference_provider === "aws" ? "aws" : p.inference_provider === "kaggle_yolo26" ? "kaggle_yolo26" : "kaggle";
      if (provider === "kaggle")
        return failure("The legacy Kaggle worker does not run the pinned YOLO26m-semantic specialists. Website inference is unavailable until the dual-model workflow is verified.", 503);
      if (provider === "aws" && Deno.env.get("AWS_PHOTO_PILOT_ENABLED") !== "true")
        return failure("Private AWS photo processing is not yet activated for website uploads", 503);
      if (provider === "kaggle_yolo26" && Deno.env.get("PINNED_KAGGLE_UPLOAD_ENABLED") !== "true")
        return failure("Private pinned photo/video processing is not yet activated for website uploads", 503);
      const lat = p.lat == null ? null : Number(p.lat);
      const lng = p.lng == null ? null : Number(p.lng);
      if ((lat == null) !== (lng == null) || (lat != null && (!Number.isFinite(lat) || !Number.isFinite(lng))))
        throw new Error("Supply both coordinates or neither");
      const count = Number(p.photos);
      if (!Number.isInteger(count) || count < 1 || count > 250) throw new Error("A survey needs 1–250 assets");
      if (provider === "aws" && count > 4) throw new Error("Private AWS photo processing accepts up to four photos per survey.");
      if (provider === "kaggle_yolo26" && count > 11) throw new Error("Pinned processing accepts up to ten photos and one video.");
      const cropStage = String(p.crop_stage || "unknown");
      const cropStages = ["unknown", "seedling", "vegetative", "reproductive", "ripening", "post_harvest"];
      if (!cropStages.includes(cropStage)) throw new Error("Unsupported crop stage");
      const allowedConditions = ["standing_water", "lodging", "dry_or_cracked_soil", "nutrient_stress_suspected", "pest_damage_suspected"];
      const rawFieldConditions: unknown[] = Array.isArray(p.field_conditions) ? p.field_conditions : [];
      const fieldConditions = [...new Set(rawFieldConditions.map(String))];
      if (fieldConditions.some((item) => !allowedConditions.includes(item))) throw new Error("Unsupported field condition");
      const locationSource = ["exif_median", "manual_pin"].includes(String(p.location_source)) ? String(p.location_source) : lat == null ? "none" : "manual_pin";
      const place = lat == null ? null : check(await db.rpc("rg_reverse_geocode", { p_lat: lat, p_lng: lng }));
      const inserted = requireResult(await db.from("rg_surveys").insert({
        id: surveyId,
        name: requiredText(p.name, 160),
        location: place?.label || optionalText(p.location, 240) || "Location pending review",
        place,
        location_source: locationSource,
        captured_at: new Date(requiredText(p.captured_at, 64)).toISOString(),
        camera: requiredText(p.camera, 120),
        photos: count,
        expected_assets: count,
        severity: "not_calibrated",
        lat,
        lng,
        location_status: lat == null ? "missing" : "verified",
        created_by: user.id,
        inference_provider: provider,
        crop_stage: cropStage,
        field_conditions: fieldConditions,
      }).select("id").single());
      return reply({ id: inserted.id }, 201);
    }

    if (action === "upload-intent") {
      const surveyId = uuid(p.flight_id);
      const survey = check(await db.from("rg_surveys").select("id,created_by,inference_provider").eq("id", surveyId).single());
      if (!survey) return failure("Survey not found", 404);
      const mime = requiredText(p.content_type, 100);
      const allowed = ["image/jpeg", "image/png", "video/mp4", "text/csv", "application/json", "application/x-subrip", "text/plain"];
      if (!allowed.includes(mime)) throw new Error("Unsupported media type");
      const bytes = Number(p.bytes);
      if (!Number.isInteger(bytes) || bytes < 1 || bytes > 5 * 1024 * 1024 * 1024) throw new Error("Unsupported file size");
      if (survey.inference_provider === "aws" && (!["image/jpeg", "image/png"].includes(mime) || bytes > 200_000_000))
        throw new Error("Private AWS processing currently accepts JPEG/PNG photos up to 200 MB; video support is not active yet.");
      let clip: ReturnType<typeof validateVideoClipSelection> | null = null;
      let linkedPhotoAssetId: string | null = null;
      if (survey.inference_provider === "kaggle_yolo26") {
        if (mime === "video/mp4") {
          const sourceDuration = p.duration_seconds;
          clip = validateVideoClipSelection(sourceDuration, p.clip_start_seconds,
            p.clip_duration_seconds, p.clip_target_fps);
          linkedPhotoAssetId = uuid(p.linked_photo_asset_id);
          const linkedPhoto = check(await db.from("rg_assets")
            .select("id,mime,state").eq("id", linkedPhotoAssetId)
            .eq("survey_id", surveyId).single());
          if (!linkedPhoto || !["image/jpeg", "image/png"].includes(linkedPhoto.mime) || linkedPhoto.state !== "Verified")
            throw new Error("The linked GPS-reference photo must be verified in this survey");
          if (!Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width * p.height > 60_000_000 ||
            bytes > 5 * 1024 * 1024 * 1024)
            throw new Error("Unsupported video dimensions or size");
        } else if (!["image/jpeg", "image/png"].includes(mime) || bytes > 200_000_000 ||
          !Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width * p.height > 60_000_000) {
          throw new Error("Pinned specialist processing requires original JPEG/PNG photos and one optional MP4 clip");
        }
      }
      const checksum = requiredText(p.checksum, 64).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error("Invalid SHA-256 checksum");
      const md5 = requiredText(p.md5_checksum, 32).toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(md5)) throw new Error("Invalid MD5 checksum");
      const assetId = crypto.randomUUID();
      const uploadUrl = await startDriveUpload({
        assetId,
        surveyId,
        filename: requiredText(p.filename, 240),
        mime,
        bytes,
        checksum,
      });
      check(await db.from("rg_assets").insert({
        id: assetId,
        survey_id: surveyId,
        filename: p.filename,
        checksum,
        md5_checksum: md5,
        mime,
        bytes,
        width: p.width || null,
        height: p.height || null,
        duration_seconds: p.duration_seconds || null,
        clip_start_seconds: clip?.start_seconds ?? null,
        clip_duration_seconds: clip?.duration_seconds ?? null,
        clip_target_fps: clip?.target_fps ?? null,
        linked_photo_asset_id: linkedPhotoAssetId,
        orientation: p.orientation || 1,
        capture_time: p.capture_time || null,
        exif_lat: p.exif_lat ?? null,
        exif_lng: p.exif_lng ?? null,
        state: "Uploading",
      }));
      const sessionId = crypto.randomUUID();
      check(await db.from("rg_upload_sessions").insert({
        id: sessionId,
        asset_id: assetId,
        provider_session_url: uploadUrl,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_by: user.id,
      }));
      return reply({
        asset_id: assetId,
        session_id: sessionId,
        upload_url: uploadUrl,
        required_headers: { "Content-Type": mime },
      }, 201);
    }

    if (action === "resume-upload-intent") {
      const surveyId = uuid(p.flight_id);
      const checksum = requiredText(p.checksum, 64).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error("Invalid SHA-256 checksum");
      const survey = check(await db.from("rg_surveys")
        .select("id,created_by,status").eq("id", surveyId).single());
      if (!survey || survey.created_by !== user.id) return failure("Survey not found", 404);
      if (survey.status !== "Awaiting upload")
        return failure("This survey is no longer accepting original media", 409);
      const asset = check(await db.from("rg_assets")
        .select("id,survey_id,filename,mime,bytes,checksum,md5_checksum,state,drive_file_id")
        .eq("survey_id", surveyId).eq("checksum", checksum).maybeSingle());
      if (!asset) return failure("Matching interrupted upload was not found", 404);
      const md5 = requiredText(p.md5_checksum, 32).toLowerCase();
      const bytes = Number(p.bytes);
      const mime = requiredText(p.content_type, 100);
      if (asset.md5_checksum !== md5 || Number(asset.bytes) !== bytes || asset.mime !== mime)
        return failure("Reselected file does not match the interrupted original", 409);
      if (asset.state === "Verified" && asset.drive_file_id)
        return reply({ asset_id: asset.id, already_verified: true });
      const uploadUrl = await replaceDriveUploadSession(asset, user.id);
      return reply({
        asset_id: asset.id,
        upload_url: uploadUrl,
        required_headers: { "Content-Type": asset.mime },
        resumed: true,
      });
    }

    if (action === "upload-failed") {
      const assetId = uuid(p.asset_id);
      const message = requiredText(p.error, 500);
      const asset = requireResult(await db.from("rg_assets")
        .select("id,survey_id").eq("id", assetId).single());
      const survey = check(await db.from("rg_surveys")
        .select("id,created_by,status").eq("id", asset.survey_id).single());
      if (!survey || survey.created_by !== user.id) return failure("Survey not found", 404);
      if (survey.status !== "Awaiting upload")
        return failure("The survey already advanced beyond upload", 409);
      check(await db.from("rg_assets").update({
        state: "Rejected",
        error: message,
        updated_at: new Date().toISOString(),
      }).eq("id", assetId));
      check(await db.from("rg_upload_sessions").update({
        state: "cancelled",
        updated_at: new Date().toISOString(),
      }).eq("asset_id", assetId));
      check(await db.from("rg_surveys").update({
        note: "Upload paused. Reselect the exact original batch to resume safely.",
        stage_updated_at: new Date().toISOString(),
      }).eq("id", asset.survey_id));
      return reply({ paused: true });
    }

    if (action === "recover-upload") {
      const assetId = uuid(p.asset_id);
      const asset = requireResult(await db.from("rg_assets")
        .select("id,survey_id,mime,bytes,md5_checksum,state,drive_file_id")
        .eq("id", assetId).single());
      const survey = check(await db.from("rg_surveys")
        .select("id,created_by,status").eq("id", asset.survey_id).single());
      if (!survey || survey.created_by !== user.id) return failure("Survey not found", 404);
      if (asset.state === "Verified" && asset.drive_file_id)
        return reply({ recovered: true, asset_id: asset.id, drive_file_id: asset.drive_file_id,
          job: await createJobIfReady(asset.survey_id) });
      if (survey.status !== "Awaiting upload")
        return failure("This survey is no longer accepting original media", 409);
      const metadata = await recoverUploadedDriveFile(asset);
      if (!metadata) return reply({ recovered: false, asset_id: asset.id });
      check(await db.from("rg_assets").update({
        drive_file_id: metadata.id,
        state: "Verified",
        error: null,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", asset.id));
      check(await db.from("rg_upload_sessions").update({
        state: "complete",
        offset_bytes: asset.bytes,
        updated_at: new Date().toISOString(),
      }).eq("asset_id", asset.id));
      const job = await createJobIfReady(asset.survey_id);
      return reply({ recovered: true, asset_id: asset.id, drive_file_id: metadata.id, job });
    }

    if (action === "retry-processing") {
      const surveyId = uuid(p.id);
      const survey = check(await db.from("rg_surveys")
        .select("id,created_by,status").eq("id", surveyId).single());
      if (!survey || survey.created_by !== user.id) return failure("Survey not found", 404);
      if (survey.status !== "Failed")
        return failure("Only a failed survey can be retried", 409);
      const active = check(await db.from("rg_processing_jobs").select("id")
        .eq("survey_id", surveyId)
        .in("status", ["Queued", "Submitting", "Waiting for GPU", "Running", "Validating results"])
        .limit(1).maybeSingle());
      if (active) return failure("This survey already has active processing", 409);
      // A retry is a new immutable execution attempt. Reusing the prior
      // manifest/job would collide with its callback sequence and completed
      // outbox row, leaving the survey queued forever.
      const job = await createJobIfReady(surveyId, crypto.randomUUID());
      if (!job) return failure("All original media must be verified before retrying", 409);
      return reply({ retried: true, job }, 201);
    }

    if (action === "upload-complete") {
      const assetId = uuid(p.asset_id);
      const driveFileId = requiredText(p.drive_file_id, 200);
      const asset = requireResult(await db.from("rg_assets").select("*,rg_upload_sessions!inner(id,state)").eq("id", assetId).single());
      const token = await googleAccessToken();
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?fields=id,name,mimeType,size,md5Checksum,appProperties,parents&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Uploaded Drive file could not be verified");
      const metadata = await response.json();
      if (
        metadata.appProperties?.riceguard_asset_id !== assetId ||
        metadata.appProperties?.riceguard_survey_id !== asset.survey_id ||
        Number(metadata.size) !== Number(asset.bytes) ||
        metadata.mimeType !== asset.mime ||
        String(metadata.md5Checksum || "").toLowerCase() !== String(asset.md5_checksum).toLowerCase()
      ) {
        check(await db.from("rg_assets").update({ state: "Rejected", error: "Drive metadata or checksum mismatch" }).eq("id", assetId));
        throw new Error("Uploaded file failed size, type or checksum verification");
      }
      check(await db.from("rg_assets").update({ drive_file_id: driveFileId, state: "Verified", verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", assetId));
      check(await db.from("rg_upload_sessions").update({ state: "complete", offset_bytes: asset.bytes, updated_at: new Date().toISOString() }).eq("asset_id", assetId));
      const job = await createJobIfReady(asset.survey_id);
      return reply({ verified: true, job });
    }

    if (action === "verify-findings") {
      const surveyId = uuid(p.id);
      const job = requireResult(await db.from("rg_processing_jobs").select("id")
        .eq("survey_id", surveyId).eq("provider", "kaggle_yolo26").in("status", ["Needs review", "Reviewed"])
        .order("created_at", { ascending: false }).limit(1).single());
      if (!Array.isArray(p.reviews)) return failure("Choose Tama or Mali for every finding", 400);
      const reviews = p.reviews.map((item: Record<string, unknown>) => ({
        source_asset_id: uuid(item.source_asset_id), disease: requiredText(item.disease, 20),
        decision: item.decision === "accepted" ? "accepted" : "rejected",
        ...(item.decision === "accepted" ? {} : { reason: requiredText(item.reason, 20), note: optionalText(item.note, 500) }),
      }));
      const result = check(await db.rpc("rg_verify_findings", { p_job: job.id, p_actor: user.id, p_reviews: reviews }));
      startAutoPipeline(surveyId);
      return reply({ ...result, automation: "queued" });
    }
    if (action === "confirm-no-disease") {
      const surveyId = uuid(p.id);
      const survey = requireResult(await db.from("rg_surveys").select("status,active_result_revision").eq("id", surveyId).single());
      if (survey.status !== "Needs review") return failure("This survey is not waiting for review", 409);
      check(await db.from("rg_surveys").update({ status: "Reviewed", approved_result_revision: survey.active_result_revision,
        reviewed_by: user.id, reviewed_at: new Date().toISOString(), stage_updated_at: new Date().toISOString() }).eq("id", surveyId));
      check(await db.from("rg_processing_jobs").update({ status: "Reviewed", updated_at: new Date().toISOString() })
        .eq("survey_id", surveyId).eq("status", "Needs review"));
      return reply({ confirmed: true });
    }
    if (action === "retry-automation") {
      const surveyId = uuid(p.id);
      check(await db.from("rg_surveys").update({ auto_status: "pending", auto_attempts: 0, auto_next_at: new Date().toISOString(),
        auto_error: null }).eq("id", surveyId).in("auto_status", ["failed", "retry", "done"]));
      startAutoPipeline(surveyId);
      return reply({ queued: true });
    }

    if (action === "review-readiness") {
      return reply(check(await db.rpc("rg_review_readiness", { p_id: uuid(p.id) })));
    }
    if (action === "save-severity-review") {
      if (!Number.isInteger(p.result_revision) || p.result_revision < 1 || !Number.isInteger(p.advisory_revision) || p.advisory_revision < 1) return failure("Reload the current result and advisory revision", 400);
      const entries = validateSeverityReview(p.entries);
      return reply(check(await db.rpc("rg_save_severity_review", { p_id: uuid(p.id), p_result: p.result_revision,
        p_expected: p.advisory_revision, p_actor: user.id, p_entries: entries })));
    }
    if (action === "save-location") {
      if (!Number.isInteger(p.advisory_revision) || p.advisory_revision < 1) return failure("Reload the current advisory revision", 400);
      return reply(check(await db.rpc("rg_save_review_location", { p_id: uuid(p.id), p_expected: p.advisory_revision,
        p_actor: user.id, p_choice: p.choice })));
    }
    if (action === "save-field-severity") {
      const revision = Number(p.result_revision);
      if (!Number.isInteger(revision) || revision < 1) return failure("A current result revision is required", 400);
      const evidence = validateFieldSeverity(p.evidence);
      check(await db.rpc("rg_save_field_severity", { p_survey: uuid(p.id), p_revision: revision, p_actor: user.id, p_evidence: evidence }));
      return reply({ saved: true, basis: evidence.basis, model_calibrated: false });
    }

    if (action === "review-survey") {
      const surveyId = uuid(p.id);
      const revision = Number(p.result_revision);
      if (!Number.isInteger(revision) || revision < 1) throw new Error("Invalid result revision");
      const survey = requireResult(await db.from("rg_surveys").select("status,active_result_revision").eq("id", surveyId).single());
      if (survey.status !== "Needs review" || survey.active_result_revision !== revision)
        return failure("The displayed result revision is stale or not ready for review", 409);
      const v2Job = check(await db.from("rg_processing_jobs")
        .select("id,provider").eq("survey_id", surveyId).in("provider", ["aws", "kaggle_yolo26"])
        .eq("status", "Needs review").order("created_at", { ascending: false }).limit(1).maybeSingle());
      if (v2Job) {
        if (!Array.isArray(p.reviews)) return failure("Review both diseases on every source image or clip", 400);
        const reviewed = check(await db.rpc(v2Job.provider === "aws" ? "rg_review_aws_job" : "rg_review_pinned_job", {
          p_job: v2Job.id, p_revision: revision, p_actor: user.id,
          p_reviews: p.reviews, p_location_approved: p.location_approved === true,
          p_media_approved: p.media_approved === true,
        }));
        return reply(reviewed);
      }
      const result = check(await db.from("rg_result_revisions").select("id").eq("survey_id", surveyId).eq("revision", revision).single());
      if (!result) return failure("Validated result revision not found", 409);
      check(await db.from("rg_surveys").update({
        status: "Reviewed",
        approved_result_revision: revision,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        stage_updated_at: new Date().toISOString(),
      }).eq("id", surveyId));
      check(await db.from("rg_bulletins").update({
        result_revision: revision,
        public_location_approved: p.location_approved === true,
        media_approved: p.media_approved === true,
        status: "draft",
        updated_at: new Date().toISOString(),
      }).eq("survey_id", surveyId));
      return reply({ reviewed: true, result_revision: revision });
    }

    if (action === "save-draft") {
      const bulletinId = uuid(p.id);
      const current = requireResult(await db.from("rg_bulletins").select("advisory_revision,status").eq("id", bulletinId).is("archived_at", null).single());
      // Older live clients omit this field; the update below still checks the fetched revision atomically.
      if (p.advisory_revision != null && Number(p.advisory_revision) !== current.advisory_revision) return failure("The advisory changed; reload before saving your edits", 409);
      if (current.status === "published") return failure("Create an explicit correction version for a published advisory", 409);
      const updated = requireResult(await db.from("rg_bulletins").update({
        ...(p.title != null ? { title: requiredText(p.title, 240) } : {}),
        body: requiredText(p.body, 6000),
        action: requiredText(p.action, 6000),
        ...(p.limitations != null ? {limitations: optionalText(p.limitations, 4000) || "Field verification is required."} : {}),
        advisory_revision: current.advisory_revision + 1,
        recipient_preview_hash: null,
        reviewer: null,
        reviewer_id: null,
        context_review_required: false,
        updated_at: new Date().toISOString(),
      }).eq("id", bulletinId).eq("advisory_revision", current.advisory_revision).select("advisory_revision").single());
      return reply({ saved: true, advisory_revision: updated.advisory_revision });
    }

    if (action === "archive-advisory") {
      const revision = Number(p.advisory_revision);
      if (p.confirmed !== true || !Number.isInteger(revision) || revision < 1) return failure("Confirm deletion of the current advisory", 400);
      check(await db.rpc("rg_archive_advisory", { p_id: uuid(p.id), p_actor: user.id, p_expected_revision: revision }));
      return reply({ archived: true, recoverable: true });
    }

    if (action === "create-correction") {
      const bulletinId = uuid(p.id);
      const current = requireResult(await db.from("rg_bulletins")
        .select("id,status,advisory_revision").eq("id", bulletinId).is("archived_at", null).single());
      if (current.status !== "published") return failure("Only a published advisory needs a correction draft", 409);
      if (p.advisory_revision != null && p.advisory_revision !== current.advisory_revision) return failure("The advisory changed; reload before creating a correction", 409);
      const correctionNote = requiredText(p.correction_note, 500);
      const updated = requireResult(await db.from("rg_bulletins").update({
        status: "draft",
        advisory_revision: current.advisory_revision + 1,
        correction_note: correctionNote,
        recipient_preview_hash: null,
        reviewer: null,
        reviewer_id: null,
        updated_at: new Date().toISOString(),
      }).eq("id", bulletinId).eq("status", "published")
        .eq("advisory_revision", current.advisory_revision).select("advisory_revision").single());
      check(await db.from("rg_events").insert({
        kind: "advisory-correction-draft-created", entity_id: bulletinId, actor_id: user.id,
        detail: { advisory_revision: updated.advisory_revision, correction_note: correctionNote },
      }));
      return reply({ correction_draft: true, advisory_revision: updated.advisory_revision });
    }

    if (action === "sms-gateway-health") return reply(await smsGatewayHealth(db));
    if (action === "sms-gateway-register-ping") {
      const token = Deno.env.get("SMS_GATE_WEBHOOK_TOKEN");
      if (!token) return failure("The SMS webhook token is not configured", 503, "CONFIGURATION_REQUIRED");
      return reply(await registerPingWebhook(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sms-webhook?token=${encodeURIComponent(token)}`));
    }

    if (action === "sms-preview" || action === "sms-enqueue" || action === "sms-status") {
      if (action === "sms-status") {
        return reply({ campaigns: check(await db.rpc("rg_sms_campaign_stats")), gateway: await smsGatewayStatus(), dispatch_enabled: Deno.env.get("SMS_DISPATCH_ENABLED") === "true" });
      }
      const bulletinId = uuid(p.id);
      const bulletin = requireResult(await db.from("rg_bulletins").select("id,title,disease,diseases,action,slug,lat,lng,public_location_approved,advisory_revision,status,archived_at").eq("id", bulletinId).single());
      const message = smsAdvisoryMessage(bulletin, `${origin}/advisories/${bulletin.slug}`, Boolean(Deno.env.get("SMS_GATE_WEBHOOK_SECRET") || Deno.env.get("SMS_GATE_WEBHOOK_TOKEN")));
      const contactId = p.contact_id ? uuid(p.contact_id) : null;
      const gateway = await smsGatewayStatus();
      const dispatchEnabled = Deno.env.get("SMS_DISPATCH_ENABLED") === "true";
      const selection = gatewaySelection(Deno.env.get("SMS_GATE_DEVICE_ID"), Deno.env.get("SMS_GATE_SIM_NUMBER"));
      // The preview RPC is STABLE: no recipient, campaign, advisory or audit writes.
      const preview = check(await db.rpc("rg_sms_preview", { p_bulletin: bulletinId, p_message: message, p_contact: contactId }));
      if (action === "sms-preview") return reply({ ...preview, message, ...smsSegments(message), gateway, dispatch_enabled: dispatchEnabled,
        device_selected: Boolean(selection.deviceId), sim_selected: Boolean(selection.simNumber), dry_run: true, sends: 0,
        quiet_hours: isManilaQuietHour(), resume_at: isManilaQuietHour() ? nextManilaSixAm() : null,
        receipt_ready: Boolean(Deno.env.get("SMS_GATE_WEBHOOK_SECRET") || Deno.env.get("SMS_GATE_WEBHOOK_TOKEN")),
      });
      if (p.confirmed !== true) return failure("Confirm this separate SMS campaign before queueing", 400);
      if (!dispatchEnabled) return failure("SMS dispatch is disabled. Preview is available without sending.", 409);
      if (gateway !== "connected") return failure("The selected SMS gateway device must be online before queueing", 409);
      if (!(Deno.env.get("SMS_GATE_WEBHOOK_SECRET") || Deno.env.get("SMS_GATE_WEBHOOK_TOKEN"))) return failure("Delivery callbacks must be configured before queueing", 409);
      const revision = Number(p.advisory_revision);
      if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Invalid advisory revision");
      const result = check(await db.rpc("rg_sms_enqueue", { p_bulletin: bulletinId, p_actor: user.id, p_revision: revision,
        p_hash: requiredText(p.hash, 64), p_message: message, p_contact: contactId, p_device: selection.deviceId || null, p_sim: selection.simNumber || null }));
      return reply({ ...result, queued: true, delivered: false });
    }

    if (action === "recipient-preview") {
      const preview = check(await db.rpc("rg_recipient_preview_v2", { p_bulletin: uuid(p.id) }));
      return reply(preview);
    }

    if (action === "publish") {
      const bulletinId = uuid(p.id);
      if (p.send_sms === true) return failure("Publish the advisory separately. SMS is a separate staff decision.", 400);
      const readiness = check(await db.rpc("rg_review_readiness", { p_id: bulletinId }));
      if (!readiness.published && !readiness.ready) return failure(readiness.steps.filter((s: {complete:boolean}) => !s.complete).map((s: {reason:string}) => s.reason).join(" "), 409);
      const revision = Number(p.advisory_revision);
      if (!Number.isInteger(revision) || revision < 1) throw new Error("Invalid advisory revision");
      const bulletin = requireResult(await db.from("rg_bulletins")
        .select("id,survey_id,result_revision,status,diseases,advisory_source_ids,media_approved,public_media")
        .eq("id", bulletinId).is("archived_at", null).single());
      const survey = requireResult(await db.from("rg_surveys")
        .select("inference_provider,status,approved_result_revision")
        .eq("id", bulletin.survey_id).single());
      if (["aws", "kaggle_yolo26"].includes(survey.inference_provider) && bulletin.status !== "published") {
        if (survey.status !== "Reviewed" || survey.approved_result_revision !== bulletin.result_revision ||
          !bulletin.media_approved || !bulletin.diseases?.length)
          return failure("Review the detected diseases and media before publication", 409);
        if (!Array.isArray(bulletin.advisory_source_ids) || !bulletin.advisory_source_ids.length)
          return failure("Approve agricultural guidance for each reviewed disease before publication", 409);
        const approvedSources = requireResult(await db.from("rg_advisory_sources")
          .select("id,disease").in("id", bulletin.advisory_source_ids).eq("active", true));
        if (!publishGuidanceIsComplete(bulletin.diseases, bulletin.advisory_source_ids, approvedSources))
          return failure("Approved agricultural guidance is missing for a reviewed disease", 409);
        if (!Array.isArray(bulletin.public_media) || !bulletin.public_media.length)
          await stageV2PublicMedia(bulletin, survey.inference_provider as "aws" | "kaggle_yolo26");
      } else if (!["aws", "kaggle_yolo26"].includes(survey.inference_provider) && bulletin.status !== "published" &&
        (!Array.isArray(bulletin.public_media) || !bulletin.public_media.length)) {
        if (survey.status !== "Reviewed" || !bulletin.media_approved)
          return failure("Review the result and media before publication", 409);
        await stageLegacyPublicMedia(bulletin);
      }
      check(await db.rpc("rg_publish_bulletin_v2", {
        p_id: bulletinId,
        p_actor: user.id,
        p_expected_revision: revision,
        p_recipient_preview_hash: requiredText(p.recipient_preview_hash, 64),
      }));
      return reply({ published: true, sms_enqueued: false, campaign_id: null,
        public_path: readiness.public_path, map_eligible: readiness.map_eligible });
    }

    if (action === "update-contact") {
      const phone = requiredText(p.phone, 20);
      return reply(check(await db.rpc("rg_update_contact", { p_contact: uuid(p.id), p_actor: user.id,
        p_name: requiredText(p.name, 120), p_phone: phone, p_location: optionalText(p.location, 240) || "" })));
    }
    if (action === "delete-contact") {
      if (p.confirmed !== true) throw new Error("Confirm the deletion first");
      return reply(check(await db.rpc("rg_delete_contact", { p_contact: uuid(p.id), p_actor: user.id })));
    }
    if (action === "update-survey") {
      return reply(check(await db.rpc("rg_update_survey", { p_survey: uuid(p.id), p_actor: user.id,
        p_name: requiredText(p.name, 160), p_note: optionalText(p.note, 1000) || "" })));
    }
    if (action === "archive-survey") {
      if (p.confirmed !== true) throw new Error("Confirm the deletion first");
      return reply(check(await db.rpc("rg_archive_survey", { p_survey: uuid(p.id), p_actor: user.id })));
    }

    if (action === "create-contact") {
      const phone = requiredText(p.phone, 20);
      if (!/^\+639\d{9}$/.test(phone)) throw new Error("Invalid Philippine mobile number");
      const count = check(await db.from("rg_contacts").select("id", { count: "exact", head: true }));
      void count;
      const contact = requireResult(await db.from("rg_contacts").insert({
        name: requiredText(p.name, 120),
        phone,
        location: optionalText(p.location, 240) || "Location not yet registered",
        consent: false,
        verified: false,
      }).select("id").single());
      return reply({ id: contact.id }, 201);
    }

    return failure("Unknown operation", 400);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Operation failed";
    console.error(JSON.stringify({ request_id: requestId, error: detail.slice(0, 1000) }));
    if (/Stale|changed|unreviewed|Create a correction|Complete images|Advisory unavailable|Survey unavailable|Contact unavailable|Withdraw the published|Wait until processing|Confirm the deletion/i.test(detail)) return failure(detail, 409, "VALIDATION_ERROR");
    if (/Active admin role required/i.test(detail)) return failure("Active administrator approval is required", 403);
    if (["save-severity-review","save-location"].includes(requestAction)) return failure(detail, 400, "VALIDATION_ERROR");
    if (/Select a valid current Region II barangay/i.test(detail))
      return failure("Select a valid current Region II barangay", 400, "INVALID_LOCATION");
    if (/Contact already claimed/i.test(detail))
      return failure("Contact already claimed", 409, "CONTACT_CONFLICT");
    if (/Pilot contact limit reached/i.test(detail))
      return failure("Pilot contact limit reached", 409, "PILOT_LIMIT_REACHED");
    if (/Private Drive upload session failed/i.test(detail))
      return failure(detail, 503, "VALIDATION_ERROR");
    if (["upload-intent", "resume-upload-intent", "recover-upload", "upload-complete"].includes(requestAction))
      return failure(`Upload preparation failed: ${detail}`, 400, "VALIDATION_ERROR");
    if (/Invalid required text|Invalid identifier|Unexpected token|JSON/i.test(detail))
      return failure("Invalid request data", 400, "VALIDATION_ERROR");
    return failure("The request could not be completed", 400, "VALIDATION_ERROR");
  }
});
