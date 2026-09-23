import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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
        const signed = await db.storage.from("rg-public-previews").createSignedUploadUrl(path);
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
        preview_bucket: "rg-public-previews",
        preview_uploads: previews,
        review_uploads: reviewUploads,
      });
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
    const publicUrl = (path?: string) => path ? db.storage.from("rg-public-previews").getPublicUrl(path).data.publicUrl : "";
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
      image: publicUrl(previewPaths?.[disease]),
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
