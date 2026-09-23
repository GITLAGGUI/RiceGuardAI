import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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
const fail = (message: string, status = 400) => reply({ error: message }, status);
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
const check = <T>(result: { data: T; error: { message: string } | null }) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
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

async function smsGatewayStatus(): Promise<"connected" | "offline" | "credentials_present" | "configuration_required" | "error"> {
  const user = Deno.env.get("SMS_GATE_USER");
  const pass = Deno.env.get("SMS_GATE_PASS");
  if (!user || !pass) return Deno.env.get("SMS_GATE_TOKEN") ? "credentials_present" : "configuration_required";
  try {
    const response = await fetch("https://api.sms-gate.app/3rdparty/v1/devices", {
      headers: { Authorization: `Basic ${btoa(`${user}:${pass}`)}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 401 || response.status === 403) return "error";
    if (!response.ok) return "offline";
    const devices = await response.json();
    if (!Array.isArray(devices)) return "credentials_present";
    return devices.some((device) => {
      const seen = Date.parse(String(device.lastSeen || ""));
      return Number.isFinite(seen) && Date.now() - seen < 10 * 60_000;
    }) ? "connected" : "offline";
  } catch {
    return "offline";
  }
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
  if (!response.ok || !uploadUrl) throw new Error("Could not create a resumable Drive upload");
  return uploadUrl;
}

async function createJobIfReady(surveyId: string) {
  const survey = check(await db.from("rg_surveys").select("*").eq("id", surveyId).single());
  const assets = check(
    await db
      .from("rg_assets")
      .select("id,filename,mime,bytes,checksum,md5_checksum,width,height,duration_seconds,orientation,drive_file_id,capture_time,exif_lat,exif_lng,state")
      .eq("survey_id", surveyId)
      .order("id"),
  ) || [];
  if (assets.length !== survey.expected_assets || assets.some((asset) => asset.state !== "Verified"))
    return null;
  const manifest = {
    schema_version: "riceguard.batch.v1",
    survey_id: surveyId,
    captured_at: survey.captured_at,
    location_status: survey.location_status,
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
      worker_token_hash: await sha256(placeholderToken),
      worker_token_expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    })
    .select("id,run_id,status")
    .single();
  if (error && !error.message.toLowerCase().includes("duplicate")) throw new Error(error.message);
  const resolved = job || check(
    await db.from("rg_processing_jobs").select("id,run_id,status").eq("manifest_hash", manifestHash).single(),
  );
  check(await db.from("rg_surveys").update({
    status: "Queued",
    progress: 0,
    manifest_hash: manifestHash,
    stage_updated_at: new Date().toISOString(),
  }).eq("id", surveyId));
  check(await db.from("rg_outbox").upsert(
    { kind: "kaggle-dispatch", entity_id: resolved.id, state: "pending", available_at: new Date().toISOString() },
    { onConflict: "kind,entity_id", ignoreDuplicates: true },
  ));
  return resolved;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return fail("Method not allowed", 405);
  if (req.headers.get("origin") && req.headers.get("origin") !== origin)
    return fail("Origin not allowed", 403);
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return fail("Authentication required", 401);
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return fail("Invalid session", 401);

  try {
    const raw = await req.text();
    if (raw.length > 120_000) return fail("Request too large", 413);
    const { action, payload: p = {} } = JSON.parse(raw);
    const user = auth.user;

    if (action === "register-contact") {
      if (!user.phone_confirmed_at || !user.phone) return fail("Verified phone required", 403);
      const phone = user.phone.startsWith("+") ? user.phone : `+${user.phone}`;
      const contactId = check(await db.rpc("rg_update_contact", {
        p_user: user.id,
        p_name: requiredText(p.name, 120),
        p_barangay: requiredText(p.barangay_code, 12),
        p_consent: p.consent === true,
        p_phone: phone,
      }));
      return reply({ contact_id: contactId });
    }
    if (action === "opt-out") {
      const contact = check(await db.from("rg_contacts").select("id").eq("account_id", user.id).single());
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
      return fail("Active admin role required", 403);
    if (assuranceLevel(token) !== "aal2") return fail("Administrator MFA verification required", 403);

    if (action === "snapshot") {
      const [surveys, bulletins, contacts, farms, campaigns, assets, jobs, models, smsStatus] = await Promise.all([
        db.from("rg_surveys").select("id,name,location,captured_at,camera,status,photos,severity,lat,lng,location_status,progress,stage_updated_at,active_result_revision,approved_result_revision,note").order("created_at", { ascending: false }).limit(500),
        db.from("rg_bulletins").select("id,slug,title,location,disease,severity,body,action,date,status,image,reviewer,sample,lat,lng,published_at,updated_at,revision,advisory_revision,result_revision").order("created_at", { ascending: false }).limit(500),
        db.from("rg_contacts").select("id,name,phone,location,consent,verified").limit(100),
        db.from("rg_farms").select("id,contact_id,geometry"),
        db.from("rg_campaigns").select("id,bulletin_id,created_at,recipients,status,sample").order("created_at", { ascending: false }).limit(500),
        db.from("rg_assets").select("id,survey_id,filename,mime,bytes,state,preview_url,drive_file_id,checksum,width,height,duration_seconds").order("created_at", { ascending: false }).limit(1000),
        db.from("rg_processing_jobs").select("id,survey_id,status,progress,kaggle_kernel_ref,run_id,error,result_manifest,created_at,updated_at").order("created_at", { ascending: false }).limit(500),
        db.from("rg_model_registry").select("id,disease,version,architecture,encoder,input_size,overlap,threshold,minimum_component_pixels,active,validation_summary").order("disease"),
        smsGatewayStatus(),
      ]);
      [surveys, bulletins, contacts, farms, campaigns, assets, jobs, models].forEach((r) => { if (r.error) throw new Error(r.error.message); });
      const farmRows = farms.data || [];
      const jobRows = await Promise.all((jobs.data || []).map(async (job) => {
        const reviewUrls: Record<string, Record<string, string>> = {};
        for (const asset of job.result_manifest?.assets || []) {
          const paths = asset.review_paths || {};
          reviewUrls[asset.source_asset_id] = {};
          for (const [variant, path] of Object.entries(paths)) {
            const signed = await db.storage.from("rg-review-previews").createSignedUrl(String(path), 3600);
            if (!signed.error) reviewUrls[asset.source_asset_id][variant] = signed.data.signedUrl;
          }
        }
        return { ...job, review_urls: reviewUrls };
      }));
      return reply({
        surveys: surveys.data || [],
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
        providers: {
          drive: Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN") ? "connected" : "configuration_required",
          kaggle: Deno.env.get("KAGGLE_DISPATCH_URL") && Deno.env.get("KAGGLE_DISPATCH_SECRET") ? "connected" : "configuration_required",
          sms: smsStatus,
          advisory: Deno.env.get("OLLAMA_API_KEY") ? "connected" : "configuration_required",
        },
      });
    }

    if (action === "create-survey") {
      const surveyId = p.id ? uuid(p.id) : crypto.randomUUID();
      const lat = p.lat == null ? null : Number(p.lat);
      const lng = p.lng == null ? null : Number(p.lng);
      if ((lat == null) !== (lng == null) || (lat != null && (!Number.isFinite(lat) || !Number.isFinite(lng))))
        throw new Error("Supply both coordinates or neither");
      const count = Number(p.photos);
      if (!Number.isInteger(count) || count < 1 || count > 250) throw new Error("A survey needs 1–250 assets");
      const inserted = check(await db.from("rg_surveys").insert({
        id: surveyId,
        name: requiredText(p.name, 160),
        location: optionalText(p.location, 240) || "Location pending review",
        captured_at: new Date(requiredText(p.captured_at, 64)).toISOString(),
        camera: requiredText(p.camera, 120),
        photos: count,
        expected_assets: count,
        severity: "not_calibrated",
        lat,
        lng,
        location_status: p.location_status || (lat == null ? "missing" : "needs_review"),
        created_by: user.id,
      }).select("id").single());
      return reply({ id: inserted.id }, 201);
    }

    if (action === "upload-intent") {
      const surveyId = uuid(p.flight_id);
      const survey = check(await db.from("rg_surveys").select("id,created_by").eq("id", surveyId).single());
      if (!survey) return fail("Survey not found", 404);
      const mime = requiredText(p.content_type, 100);
      const allowed = ["image/jpeg", "image/png", "video/mp4", "text/csv", "application/json", "application/x-subrip", "text/plain"];
      if (!allowed.includes(mime)) throw new Error("Unsupported media type");
      const bytes = Number(p.bytes);
      if (!Number.isInteger(bytes) || bytes < 1 || bytes > 5 * 1024 * 1024 * 1024) throw new Error("Unsupported file size");
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
        orientation: p.orientation || 1,
        capture_time: p.capture_time || null,
        exif_lat: p.exif_lat || null,
        exif_lng: p.exif_lng || null,
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

    if (action === "upload-complete") {
      const assetId = uuid(p.asset_id);
      const driveFileId = requiredText(p.drive_file_id, 200);
      const asset = check(await db.from("rg_assets").select("*,rg_upload_sessions!inner(id,state)").eq("id", assetId).single());
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

    if (action === "review-survey") {
      const surveyId = uuid(p.id);
      const revision = Number(p.result_revision);
      if (!Number.isInteger(revision) || revision < 1) throw new Error("Invalid result revision");
      const survey = check(await db.from("rg_surveys").select("status,active_result_revision").eq("id", surveyId).single());
      if (survey.status !== "Needs review" || survey.active_result_revision !== revision)
        return fail("The displayed result revision is stale or not ready for review", 409);
      const result = check(await db.from("rg_result_revisions").select("id").eq("survey_id", surveyId).eq("revision", revision).single());
      if (!result) return fail("Validated result revision not found", 409);
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
      const current = check(await db.from("rg_bulletins").select("advisory_revision,status").eq("id", bulletinId).single());
      if (current.status === "published") return fail("Create an explicit correction version for a published advisory", 409);
      const updated = check(await db.from("rg_bulletins").update({
        body: requiredText(p.body, 6000),
        action: requiredText(p.action, 6000),
        limitations: optionalText(p.limitations, 4000) || "Field verification is required.",
        advisory_revision: current.advisory_revision + 1,
        recipient_preview_hash: null,
        reviewer: null,
        reviewer_id: null,
        updated_at: new Date().toISOString(),
      }).eq("id", bulletinId).eq("advisory_revision", current.advisory_revision).select("advisory_revision").single());
      return reply({ saved: true, advisory_revision: updated.advisory_revision });
    }

    if (action === "recipient-preview") {
      const preview = check(await db.rpc("rg_recipient_preview_v2", { p_bulletin: uuid(p.id) }));
      return reply(preview);
    }

    if (action === "publish") {
      const bulletinId = uuid(p.id);
      const revision = Number(p.advisory_revision);
      if (!Number.isInteger(revision) || revision < 1) throw new Error("Invalid advisory revision");
      const campaignId = check(await db.rpc("rg_publish_v2", {
        p_id: bulletinId,
        p_actor: user.id,
        p_expected_revision: revision,
        p_recipient_preview_hash: requiredText(p.recipient_preview_hash, 64),
      }));
      return reply({ published: true, campaign_id: campaignId });
    }

    if (action === "create-contact") {
      const phone = requiredText(p.phone, 20);
      if (!/^\+639\d{9}$/.test(phone)) throw new Error("Invalid Philippine mobile number");
      const count = check(await db.from("rg_contacts").select("id", { count: "exact", head: true }));
      void count;
      const contact = check(await db.from("rg_contacts").insert({
        name: requiredText(p.name, 120),
        phone,
        location: optionalText(p.location, 240) || "Location not yet registered",
        consent: false,
        verified: false,
      }).select("id").single());
      return reply({ id: contact.id }, 201);
    }

    return fail("Unknown operation", 400);
  } catch (error) {
    return fail(error instanceof Error ? error.message.slice(0, 300) : "Operation failed", 400);
  }
});
