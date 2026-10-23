import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { awsSettings, signedAwsPost } from "../_shared/awsSigV4.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body),
  { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const digest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((x) => x.toString(16).padStart(2, "0")).join("");
const token = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("AWS_CRON_SECRET") || Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) return json({ error: "Unauthorized" }, 401);
  if (Deno.env.get("AWS_PHOTO_PILOT_ENABLED") !== "true") return json({ status: "disabled" });
  let settings;
  try { settings = awsSettings(); } catch { return json({ error: "Private controller unavailable" }, 503); }
  const { data: job, error } = await db.rpc("rg_claim_aws_dispatch", { p_owner: `edge-${crypto.randomUUID()}`, p_lease_seconds: 300 });
  if (error) return json({ error: "Could not claim AWS job" }, 500);
  if (!job?.id) return json({ status: "idle" });
  const workerToken = token();
  const updated = await db.from("rg_processing_jobs").update({
    worker_token_hash: await digest(workerToken),
    worker_token_expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);
  if (updated.error) return json({ error: "Could not authorize worker" }, 500);
  try {
    const body = JSON.stringify({ action: "submit", job_id: job.id, run_id: job.run_id,
      worker_token: workerToken });
    const response = await signedAwsPost(body, settings);
    const provider = await response.json().catch(() => ({}));
    if (response.status === 429 && ["CREDIT_RESERVE", "CAPACITY_LIMIT"].includes(provider.code)) {
      const delay = provider.code === "CREDIT_RESERVE" ? 60 : 5;
      const at = new Date(Date.now() + delay * 60_000).toISOString();
      const reason = provider.code === "CREDIT_RESERVE" ? "Waiting for authorized AWS credit reserve" : "Another private inference job is active";
      await db.from("rg_processing_jobs").update({ status: "Queued", error: reason,
        lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      await db.from("rg_outbox").update({ state: "pending", available_at: at, last_error: reason })
        .eq("kind", "aws-dispatch").eq("entity_id", job.id);
      return json({ status: "waiting", reason, retry_at: at });
    }
    if (provider.code === "MANUAL_RECONCILIATION") {
      await db.from("rg_processing_jobs").update({ status: "Submitting", error: "AWS submission outcome requires manual reconciliation",
        lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      await db.from("rg_outbox").update({ state: "failed", last_error: "Manual AWS job reconciliation required" })
        .eq("kind", "aws-dispatch").eq("entity_id", job.id);
      return json({ status: "requires_review", job_id: job.id });
    }
    if (!response.ok || !/^[0-9a-f-]{36}$/i.test(String(provider.job_ref)))
      throw new Error(`Private controller returned HTTP ${response.status}`);
    const update = await db.from("rg_processing_jobs").update({ status: "Running", aws_job_ref: provider.job_ref,
      progress: 1, lease_owner: null, lease_expires_at: null, error: null,
      updated_at: new Date().toISOString() }).eq("id", job.id);
    if (update.error) throw new Error("Could not record AWS job receipt");
    await db.from("rg_surveys").update({ status: "Running", progress: 1,
      stage_updated_at: new Date().toISOString() }).eq("id", job.survey_id);
    await db.from("rg_outbox").update({ state: "complete", last_error: null })
      .eq("kind", "aws-dispatch").eq("entity_id", job.id);
    return json({ status: "submitted", job_id: job.id });
  } catch {
    const attempts = Number(job.submit_attempts || 1);
    const terminal = attempts >= 4;
    const reason = "Private AWS dispatch unavailable; no duplicate submission will be started without receipt verification";
    await db.from("rg_processing_jobs").update({ status: terminal ? "Failed" : "Queued", error: reason,
      lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq("id", job.id);
    await db.from("rg_surveys").update({ status: terminal ? "Failed" : "Queued",
      stage_updated_at: new Date().toISOString() }).eq("id", job.survey_id);
    await db.from("rg_outbox").update({ state: terminal ? "failed" : "pending", attempts,
      available_at: new Date(Date.now() + 15 * 60_000).toISOString(), last_error: reason })
      .eq("kind", "aws-dispatch").eq("entity_id", job.id);
    return json({ error: reason, retrying: !terminal }, terminal ? 502 : 202);
  }
});
