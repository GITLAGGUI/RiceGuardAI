import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const digest = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
async function signature(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) return json({ error: "Unauthorized" }, 401);
  const dispatchUrl = Deno.env.get("KAGGLE_DISPATCH_URL");
  const dispatchSecret = Deno.env.get("KAGGLE_DISPATCH_SECRET");
  if (!dispatchUrl || !dispatchSecret) return json({ error: "Kaggle dispatcher is not configured" }, 503);
  const owner = `edge-${crypto.randomUUID()}`;
  const { data: job, error } = await db.rpc("rg_claim_dispatch_v2", { p_owner: owner, p_lease_seconds: 120 });
  if (error) return json({ error: error.message }, 500);
  if (!job?.id) return json({ status: "idle" });

  const workerToken = randomToken();
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const callbackBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1/worker-callback`;
  const body = JSON.stringify({
    action: "submit",
    job_id: job.id,
    run_id: job.run_id,
    worker_token: workerToken,
    worker_callback_url: callbackBase,
  });
  await db.from("rg_processing_jobs").update({
    worker_token_hash: await digest(workerToken),
    worker_token_expires_at: expires,
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);

  try {
    const response = await fetch(dispatchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-RiceGuard-Signature": await signature(dispatchSecret, body) },
      body,
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 429 || result.code === "GPU_QUOTA") {
      const retryAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await db.from("rg_processing_jobs").update({ status: "Waiting for GPU", error: "Waiting for GPU availability", lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      await db.from("rg_outbox").update({ state: "pending", available_at: retryAt, last_error: "Waiting for GPU availability" }).eq("kind", "kaggle-dispatch").eq("entity_id", job.id);
      return json({ status: "waiting_for_gpu", job_id: job.id, retry_at: retryAt });
    }
    if (!response.ok) throw new Error(result.error || `Dispatcher returned ${response.status}`);
    await db.from("rg_processing_jobs").update({
      status: "Running",
      kaggle_kernel_ref: result.kernel_ref,
      kaggle_version: result.version || null,
      progress: 1,
      lease_owner: null,
      lease_expires_at: null,
      error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    await db.from("rg_surveys").update({ status: "Running", progress: 1, stage_updated_at: new Date().toISOString() }).eq("id", job.survey_id);
    await db.from("rg_outbox").update({ state: "complete", last_error: null }).eq("kind", "kaggle-dispatch").eq("entity_id", job.id);
    return json({ status: "submitted", job_id: job.id, kernel_ref: result.kernel_ref });
  } catch (dispatchError) {
    const message = dispatchError instanceof Error ? dispatchError.message.slice(0, 400) : "Dispatch failed";
    const attempts = Number(job.submit_attempts || 1);
    const terminal = attempts >= 4;
    await db.from("rg_processing_jobs").update({
      status: terminal ? "Failed" : "Queued",
      error: message,
      lease_owner: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    await db.from("rg_surveys").update({ status: terminal ? "Failed" : "Queued", stage_updated_at: new Date().toISOString() }).eq("id", job.survey_id);
    await db.from("rg_outbox").update({
      state: terminal ? "failed" : "pending",
      attempts,
      available_at: new Date(Date.now() + Math.min(60, 2 ** attempts * 5) * 60_000).toISOString(),
      last_error: message,
    }).eq("kind", "kaggle-dispatch").eq("entity_id", job.id);
    return json({ error: message, retrying: !terminal }, terminal ? 502 : 202);
  }
});
