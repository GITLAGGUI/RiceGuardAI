import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { awsSettings, signedAwsPost } from "../_shared/awsSigV4.ts";
import { validateMediaSelection, type SourceAsset } from "../_shared/mediaSelection.ts";
import { isSupportedPinnedWorkflow, validatePinnedResult } from "../_shared/pinnedResult.ts";
import { handleAdvisoryMedia } from "../_shared/geminiConnector/completion.ts";
import { notifyReadyEvent } from "../_shared/geminiConnector/notice.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const db = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const digest = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const equal = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
};

function artifactBatches(
  action: "signed-pinned-uploads" | "verify-pinned-artifacts",
  jobId: string,
  runId: string,
  artifacts: Record<string, { sha256: string; bytes: number }>,
) {
  const entries = Object.entries(artifacts);
  const batches: Array<Record<string, { sha256: string; bytes: number }>> = [];
  let current: Record<string, { sha256: string; bytes: number }> = {};
  for (const [path, receipt] of entries) {
    const next = { ...current, [path]: receipt };
    const body = JSON.stringify({ action, job_id: jobId, run_id: runId, artifacts: next });
    if (body.length > 7_000 || Object.keys(next).length > 20) {
      if (!Object.keys(current).length) throw new Error("One private artifact receipt exceeds the control-plane limit");
      batches.push(current);
      current = { [path]: receipt };
    } else {
      current = next;
    }
  }
  if (Object.keys(current).length) batches.push(current);
  return batches;
}
let driveToken: { value: string; expires: number } | null = null;
async function googleAccessToken() {
  if (driveToken && driveToken.expires > Date.now() + 60_000) return driveToken.value;
  const clientId = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Drive is not configured");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!response.ok) throw new Error("Drive authorization failed");
  const body = await response.json();
  driveToken = { value: body.access_token, expires: Date.now() + Number(body.expires_in || 3600) * 1000 };
  return driveToken.value;
}
function validateManifest(manifest: Record<string, unknown>, job: Record<string, unknown>) {
  if (manifest.schema_version !== "riceguard.result.v1") throw new Error("Unsupported result schema");
  if (manifest.run_id !== job.run_id || manifest.source_manifest_hash !== job.manifest_hash)
    throw new Error("Result does not match the submitted run");
  const models = manifest.model_versions as Record<string, string> | undefined;
  if (!models?.BLB || !models?.["Brown Spot"]) throw new Error("Both specialist model versions are required");
  const assets = manifest.assets as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(assets) || !assets.length) throw new Error("Result assets are missing");
  for (const asset of assets) {
    if (!asset.source_asset_id || !Number.isInteger(asset.width) || !Number.isInteger(asset.height))
      throw new Error("Invalid native asset dimensions");
    const classes = asset.classes as Record<string, unknown> | undefined;
    if (!classes || Object.keys(classes).some((name) => !["BLB", "Brown Spot"].includes(name)))
      throw new Error("Invalid public disease class mapping");
  }
  const measurement = manifest.measurements as Record<string, unknown> | undefined;
  if (!measurement || !Object.hasOwn(measurement, "blb_disease_region_coverage") || !Object.hasOwn(measurement, "brown_spot_affected_leaf_coverage"))
    throw new Error("Required disease-specific measurements are missing");
}
function validateAwsResult(manifest: Record<string, unknown>, job: Record<string, unknown>) {
  const pinned = {
    BLB: "aa10d1f6c03baf189c56484db99e96ba55c646be1668d102bdaed78a43315bc6",
    "Brown Spot": "58a1f4600887577749a22f7a8b43b81174bb082d68afd5f09f1079b79a18bca5",
  };
  if (job.provider !== "aws" || manifest.schema_version !== "riceguard.result.v2" ||
    manifest.run_id !== job.run_id || manifest.source_manifest_hash !== job.manifest_hash)
    throw new Error("AWS result does not match the submitted run");
  const bundle = manifest.model_bundle as Record<string, unknown> | undefined;
  const models = bundle?.models as Record<string, Record<string, unknown>> | undefined;
  if (bundle?.workflow_sha256 !== "98faa7b8541366bfd5751036f8111930fa3bb8cb2f0233d90c6c3d82e683a0da" ||
    models?.BLB?.artifact_sha256 !== pinned.BLB || models?.["Brown Spot"]?.artifact_sha256 !== pinned["Brown Spot"])
    throw new Error("Unpinned AWS model bundle");
  const submitted = new Set((job.manifest as { assets: Array<Record<string, unknown>> }).assets.map((asset) => String(asset.id)));
  const assets = manifest.assets as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(assets) || assets.length !== submitted.size || assets.length < 1 || assets.length > 4)
    throw new Error("Missing AWS source results");
  const expectedPrefix = `website-inference/v2/jobs/${job.run_id}/outputs/`;
  const safePath = (value: unknown) => typeof value === "string" && value.startsWith(expectedPrefix) &&
    !value.includes("..") && !value.includes("?") && !value.includes(":");
  const seen = new Set<string>();
  for (const asset of assets) {
    const assetId = String(asset.source_asset_id);
    const width = Number(asset.width), height = Number(asset.height);
    if (!submitted.has(assetId) || seen.has(assetId) || asset.kind !== "image" || asset.status !== "complete" ||
      !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 60_000_000)
      throw new Error("Invalid native AWS asset result");
    seen.add(assetId);
    const findings = asset.diseases as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(findings) || findings.length !== 2 || new Set(findings.map((finding) => finding.disease)).size !== 2)
      throw new Error("Both independent specialist findings are required");
    for (const finding of findings) {
      const disease = String(finding.disease);
      const pixels = Number(finding.predicted_pixels);
      if (!Object.hasOwn(pinned, disease) || !Number.isInteger(pixels) || pixels < 0 || pixels > width * height ||
        finding.status !== (pixels ? "detected" : "not_detected") ||
        finding.mask_meaning !== (disease === "BLB" ? "disease_region" : "affected_leaf") ||
        finding.review_decision !== "pending" || !safePath(finding.mask_path))
        throw new Error("Invalid semantic disease finding");
    }
    const paths = asset.review_paths as Record<string, unknown> | undefined;
    if (!paths || ["original", "BLB", "Brown Spot", "combined"].some((variant) => !safePath(paths[variant])))
      throw new Error("Private review variants are missing");
    const location = asset.location as Record<string, unknown> | undefined;
    if (!location || !["exif", "dji_xmp", "missing"].includes(String(location.source)) ||
      (location.source === "missing" && (location.lat != null || location.lng != null)))
      throw new Error("Invalid location provenance");
    if (["exif", "dji_xmp"].includes(String(location.source)) && (typeof location.lat !== "number" || typeof location.lng !== "number" ||
      !Number.isFinite(location.lat) || !Number.isFinite(location.lng) || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180))
      throw new Error("Invalid EXIF coordinates");
  }
  const media = manifest.media as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(media) || media.length !== assets.length * 4 || media.some((item) =>
    !seen.has(String(item.source_asset_id)) || item.type !== "image" || item.sanitized !== true || !safePath(item.path)))
    throw new Error("Sanitized review media are missing");
  const severity = manifest.severity as Record<string, unknown> | undefined;
  if (!severity || severity.value !== null || severity.method_version !== null ||
    severity.availability_reason !== "lesion_measurement_not_validated")
    throw new Error("Unvalidated severity cannot be published");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return json({ error: "Worker token required" }, 401);
  try {
    const text = await req.text();
    if (text.length > 2_000_000) return json({ error: "Payload too large" }, 413);
    const body = JSON.parse(text);
    const jobId = String(body.job_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new Error("Invalid job identifier");
    const { data: job, error } = await db.from("rg_processing_jobs").select("*").eq("id", jobId).single();
    if (error || !job) return json({ error: "Job not found" }, 404);
    if (new Date(job.worker_token_expires_at).getTime() < Date.now()) return json({ error: "Worker token expired" }, 401);
    if (!equal(await digest(token), job.worker_token_hash)) return json({ error: "Invalid worker token" }, 401);

    if (body.action === "prepare-advisory-media" || body.action === "complete-advisory-media") {
      if (Deno.env.get("RG_GEMINI_VISUAL_PREPARATION_ENABLED") !== "true") {
        return json({ error: "Advisory image preparation is not enabled" }, 503);
      }
      return json(await handleAdvisoryMedia(body.action, job, body.payload, {
        rpc: (name, args) => db.rpc(name, args),
        notify: Deno.env.get("RG_GEMINI_NOTICE_ENABLED") === "true"
          ? (eventId) => notifyReadyEvent(eventId, {
            endpoint: Deno.env.get("RG_GEMINI_NOTICE_URL") || "",
            secret: Deno.env.get("RG_GEMINI_NOTICE_HMAC_SECRET") || "",
            rpc: (name, args) => db.rpc(name, args),
            now: () => new Date(), randomUUID: () => crypto.randomUUID(),
          }) : undefined,
        control: async (payload) => {
          const response = await signedAwsPost(JSON.stringify(payload), awsSettings());
          if (!response.ok) throw new Error("Advisory image control plane unavailable");
          return await response.json();
        },
      }));
    }

    if (body.action === "manifest-aws") {
      if (job.provider !== "aws" || job.manifest?.execution_provider !== "aws" ||
        !["Submitting", "Running"].includes(job.status))
        return json({ error: "AWS provider was not selected for this job" }, 409);
      if (!Array.isArray(job.manifest.assets) || !job.manifest.assets.length || job.manifest.assets.length > 4 ||
        job.manifest.assets.some((asset: Record<string, unknown>) =>
          !["image/jpeg", "image/png"].includes(String(asset.mime)) ||
          !asset.drive_file_id || asset.state !== "Verified" || Number(asset.bytes) > 200_000_000))
        return json({ error: "Unsupported or unverified AWS source asset" }, 409);
      return json({
        job_id: job.id,
        run_id: job.run_id,
        source_manifest_hash: job.manifest_hash,
        source_manifest: job.manifest,
        drive_access_token: await googleAccessToken(),
        pinned_bundle_sha256: "98faa7b8541366bfd5751036f8111930fa3bb8cb2f0233d90c6c3d82e683a0da",
      });
    }

    if (body.action === "manifest-pinned") {
      if (Deno.env.get("PINNED_KAGGLE_CALLBACK_ENABLED") !== "true" ||
        job.provider !== "kaggle_yolo26" || job.manifest?.execution_provider !== "kaggle_yolo26" ||
        !isSupportedPinnedWorkflow(job.manifest?.pinned_workflow_sha256) ||
        !["Submitting", "Running"].includes(job.status))
        return json({ error: "Pinned dual-specialist worker is not activated for this job" }, 503);
      const assets = job.manifest?.assets as (SourceAsset & { checksum?: unknown; drive_file_id?: unknown })[] | undefined;
      validateMediaSelection(assets || [], "kaggle_yolo26");
      if (assets!.some((asset) => !asset.id || !asset.mime || !asset.width || !asset.height ||
        !Number.isInteger(asset.bytes) || !/^[a-f0-9]{64}$/.test(String(asset.checksum || "")) ||
        !String(asset.drive_file_id || "")))
        throw new Error("Pinned source manifest lacks verified Drive provenance");
      const requestBody = JSON.stringify({ action: "signed-pinned-models", job_id: job.id, run_id: job.run_id });
      const response = await signedAwsPost(requestBody, awsSettings());
      const modelContext = await response.json().catch(() => null);
      const models = modelContext?.bundle?.models;
      if (!response.ok || !modelContext?.model_downloads ||
        modelContext?.bundle?.id !== "riceguard-yolo26m-semantic-20260928" ||
        models?.BLB?.sha256 !== "aa10d1f6c03baf189c56484db99e96ba55c646be1668d102bdaed78a43315bc6" ||
        models?.["Brown Spot"]?.sha256 !== "58a1f4600887577749a22f7a8b43b81174bb082d68afd5f09f1079b79a18bca5")
        throw new Error("Pinned private model downloads are unavailable");
      return json({
        job_id: job.id,
        run_id: job.run_id,
        source_manifest_hash: job.manifest_hash,
        source_manifest: job.manifest,
        drive_access_token: await googleAccessToken(),
        bundle: modelContext.bundle,
        survey_id: job.survey_id,
        advisory_media_enabled: Deno.env.get("RG_GEMINI_VISUAL_PREPARATION_ENABLED") === "true",
        model_downloads: modelContext.model_downloads,
        download_expires_in_seconds: modelContext.expires_in_seconds,
      });
    }

    if (body.action === "manifest") {
      const models = await db.from("rg_model_registry").select("disease,version,architecture,encoder,input_size,overlap,threshold,minimum_component_pixels,preprocessing,artifact_drive_file_id,artifact_sha256").eq("active", true);
      if (models.error) throw new Error(models.error.message);
      if (!models.data || models.data.length !== 2 || !models.data.some((m) => m.disease === "BLB") || !models.data.some((m) => m.disease === "Brown Spot"))
        return json({ error: "Active BLB and Brown Spot model adapters are required" }, 409);
      const previewPaths = {
        BLB: `${job.survey_id}/${job.id}/blb.webp`,
        "Brown Spot": `${job.survey_id}/${job.id}/brown-spot.webp`,
        combined: `${job.survey_id}/${job.id}/combined.webp`,
        video: `${job.survey_id}/${job.id}/review.mp4`,
      };
      const previews: Record<string, unknown> = {};
      for (const [name, path] of Object.entries(previewPaths)) {
        const signed = await db.storage.from("rg-review-previews").createSignedUploadUrl(path);
        if (signed.error) throw new Error(signed.error.message);
        previews[name] = { path, token: signed.data.token };
      }
      const reviewUploads: Record<string, Record<string, unknown>> = {};
      for (const asset of job.manifest.assets || []) {
        if (!(String(asset.mime || "").startsWith("image/") || asset.mime === "video/mp4")) continue;
        reviewUploads[asset.id] = {};
        const variants = asset.mime === "video/mp4" ? ["video"] : ["original", "BLB", "Brown Spot", "combined"];
        for (const variant of variants) {
          const extension = variant === "video" ? "mp4" : "webp";
          const key = variant.toLowerCase().replace(" ", "-");
          const path = `${job.survey_id}/${job.id}/${asset.id}-${key}.${extension}`;
          const signed = await db.storage.from("rg-review-previews").createSignedUploadUrl(path);
          if (signed.error) throw new Error(signed.error.message);
          reviewUploads[asset.id][variant] = { path, token: signed.data.token };
        }
      }
      return json({
        job_id: job.id,
        run_id: job.run_id,
        source_manifest_hash: job.manifest_hash,
        manifest: job.manifest,
        models: models.data,
        drive: {
          access_token: await googleAccessToken(),
          app_folder_id: Deno.env.get("GOOGLE_DRIVE_APP_FOLDER_ID"),
          token_expires_in_seconds: 3300,
        },
        preview_bucket: "rg-review-previews",
        preview_uploads: previews,
        review_uploads: reviewUploads,
      });
    }

    if (body.action === "prepare-pinned-uploads") {
      if (Deno.env.get("PINNED_KAGGLE_CALLBACK_ENABLED") !== "true" ||
        job.provider !== "kaggle_yolo26" || !["Submitting", "Running"].includes(job.status))
        return json({ error: "Pinned private uploads are not activated" }, 503);
      const verified = validatePinnedResult(body.payload?.result_manifest, job);
      const privateUploads: Record<string, string> = {};
      for (const artifacts of artifactBatches("signed-pinned-uploads", job.id, job.run_id, verified.artifacts!)) {
        const requestBody = JSON.stringify({ action: "signed-pinned-uploads",
          job_id: job.id, run_id: job.run_id, artifacts });
        const response = await signedAwsPost(requestBody, awsSettings());
        const signed = await response.json().catch(() => null);
        if (!response.ok || !signed?.private_uploads ||
          Object.keys(signed.private_uploads).length !== Object.keys(artifacts).length)
          throw new Error("Private upload URLs are unavailable");
        Object.assign(privateUploads, signed.private_uploads);
      }
      if (Object.keys(privateUploads).length !== Object.keys(verified.artifacts!).length)
        throw new Error("Private upload URL batch is incomplete");
      return json({ private_uploads: privateUploads, expires_in_seconds: 900 });
    }

    if (body.action === "complete-v2") {
      const sequence = Number(body.sequence);
      if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Invalid callback sequence");
      const manifest = body.payload?.result_manifest as Record<string, unknown>;
      if (!manifest || typeof manifest !== "object") throw new Error("Result manifest is missing");
      if (job.provider === "kaggle_yolo26") {
        // Staged only: activation requires a separately reviewed deployment of
        // the signed AWS object verifier and an explicit operator flag.
        if (Deno.env.get("PINNED_KAGGLE_CALLBACK_ENABLED") !== "true")
          return json({ error: "Pinned result callback is not activated" }, 503);
        const verified = validatePinnedResult(manifest, job);
        let verifiedCount = 0;
        for (const artifacts of artifactBatches("verify-pinned-artifacts", job.id, job.run_id, verified.artifacts!)) {
          const verificationRequest = JSON.stringify({ action: "verify-pinned-artifacts",
            job_id: job.id, run_id: job.run_id, artifacts });
          const response = await signedAwsPost(verificationRequest, awsSettings());
          const proof = await response.json().catch(() => null);
          if (!response.ok || proof?.verified !== true ||
            proof.artifact_count !== Object.keys(artifacts).length)
            throw new Error("Private mask and review artifacts are not independently verified");
          verifiedCount += proof.artifact_count;
        }
        if (verifiedCount !== Object.keys(verified.artifacts!).length)
          throw new Error("Private artifact verification batch is incomplete");
        const completed = await db.rpc("rg_complete_pinned_job", {
          p_job: job.id, p_sequence: sequence, p_manifest: manifest,
        });
        if (completed.error) throw new Error(completed.error.message);
        const survey = await db.from("rg_surveys").select("name").eq("id", job.survey_id).single();
        if (survey.error) throw new Error(survey.error.message);
        const fieldName = String(survey.data.name || "Rice field")
          .replace(/\s+(morning|afternoon|evening)$/i, "").trim();
        const titled = await db.from("rg_bulletins").update({
          title: `Rice Field Health Advisory — ${fieldName}`,
          updated_at: new Date().toISOString(),
        }).eq("survey_id", job.survey_id).eq("result_revision", completed.data).eq("status", "draft");
        if (titled.error) throw new Error(titled.error.message);
        return json({ accepted: true, result_revision: completed.data });
      }
      validateAwsResult(manifest, job);
      const completed = await db.rpc("rg_complete_aws_job", {
        p_job: job.id, p_sequence: sequence, p_manifest: manifest,
      });
      if (completed.error) throw new Error(completed.error.message);
      return json({ accepted: true, result_revision: completed.data });
    }

    const sequence = Number(body.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Invalid callback sequence");
    const callback = await db.from("rg_job_callbacks").insert({
      job_id: job.id,
      sequence,
      event: String(body.action),
      payload: body.payload || {},
    });
    if (callback.error?.message.toLowerCase().includes("duplicate")) return json({ replay: true, accepted: true });
    if (callback.error) throw new Error(callback.error.message);
    if (sequence <= Number(job.callback_sequence)) return json({ replay: true, accepted: true });

    if (body.action === "progress") {
      const progress = Math.max(1, Math.min(99, Math.round(Number(body.payload?.progress || 1))));
      await db.from("rg_processing_jobs").update({ callback_sequence: sequence, progress, status: "Running", updated_at: new Date().toISOString() }).eq("id", job.id);
      await db.from("rg_surveys").update({ progress, status: "Running", stage_updated_at: new Date().toISOString() }).eq("id", job.survey_id);
      return json({ accepted: true });
    }
    if (body.action === "failed") {
      const message = String(body.payload?.error || "Worker failed").slice(0, 1000);
      await db.from("rg_processing_jobs").update({ callback_sequence: sequence, status: "Failed", error: message, updated_at: new Date().toISOString(), completed_at: new Date().toISOString() }).eq("id", job.id);
      await db.from("rg_surveys").update({ status: "Failed", stage_updated_at: new Date().toISOString() }).eq("id", job.survey_id);
      return json({ accepted: true });
    }
    if (body.action !== "complete") throw new Error("Unsupported worker event");

    const manifest = body.payload?.result_manifest as Record<string, unknown>;
    validateManifest(manifest, job);
    const models = manifest.model_versions as Record<string, string>;
    const measurements = manifest.measurements as Record<string, number | null>;
    const current = await db.from("rg_surveys").select("active_result_revision,name,location,lat,lng").eq("id", job.survey_id).single();
    if (current.error) throw new Error(current.error.message);
    const revision = Number(current.data.active_result_revision || 0) + 1;
    const resultInsert = await db.from("rg_result_revisions").insert({
      survey_id: job.survey_id,
      job_id: job.id,
      revision,
      manifest,
      drive_folder_id: String(manifest.drive_folder_id || ""),
      blb_model_version: models.BLB,
      brown_spot_model_version: models["Brown Spot"],
      blb_coverage: measurements.blb_disease_region_coverage,
      brown_spot_affected_leaf_coverage: measurements.brown_spot_affected_leaf_coverage,
      visible_leaf_denominator_reviewed: false,
      severity_status: "not_calibrated",
      severity_label: "not_calibrated",
      warnings: manifest.warnings || [],
    });
    if (resultInsert.error) throw new Error(resultInsert.error.message);
    const previewPaths = manifest.preview_paths as Record<string, string> | undefined;
    const expectedPreviewPaths = {
      BLB: `${job.survey_id}/${job.id}/blb.webp`,
      "Brown Spot": `${job.survey_id}/${job.id}/brown-spot.webp`,
      combined: `${job.survey_id}/${job.id}/combined.webp`,
      video: `${job.survey_id}/${job.id}/review.mp4`,
    };
    if (previewPaths && Object.entries(previewPaths).some(([variant, path]) =>
      expectedPreviewPaths[variant as keyof typeof expectedPreviewPaths] !== path))
      throw new Error("Unrecognized private review preview path");
    const diseaseRows = (["BLB", "Brown Spot"] as const).map((disease) => ({
      survey_id: job.survey_id,
      slug: `${job.run_id}-${disease === "BLB" ? "blb" : "brown-spot"}-r${revision}`.toLowerCase(),
      title: `${disease === "BLB" ? "Bacterial Leaf Blight" : "Brown Spot"} field review — ${current.data.name}`,
      location: current.data.location || "Location pending review",
      disease,
      severity: "not_calibrated",
      body: "Automated candidate masks are ready for staff review. No public diagnosis or severity claim has been approved.",
      action: "Review the result with approved agriculture-specialist guidance before publication.",
      limitations: disease === "Brown Spot"
        ? "The Brown Spot mask represents affected-leaf coverage, not lesion-area severity."
        : "The BLB measurement represents predicted disease-region coverage within the reviewed visible-leaf denominator.",
      status: "draft",
      image: "",
      lat: current.data.lat,
      lng: current.data.lng,
      result_revision: revision,
      public_location_approved: false,
      media_approved: false,
      source_ids: (manifest.assets as Array<Record<string, unknown>>).map((asset) => String(asset.source_asset_id)),
    }));
    const bulletins = await db.from("rg_bulletins").insert(diseaseRows);
    if (bulletins.error) throw new Error(bulletins.error.message);
    await db.from("rg_processing_jobs").update({ callback_sequence: sequence, progress: 100, status: "Needs review", result_manifest: manifest, error: null, updated_at: new Date().toISOString(), completed_at: new Date().toISOString() }).eq("id", job.id);
    await db.from("rg_surveys").update({ status: "Needs review", progress: 100, active_result_revision: revision, severity: "not_calibrated", stage_updated_at: new Date().toISOString() }).eq("id", job.survey_id);
    return json({ accepted: true, result_revision: revision });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message.slice(0, 500) : "Callback failed" }, 400);
  }
});
