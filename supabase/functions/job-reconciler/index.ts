import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
async function signature(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) return json({ error: "Unauthorized" }, 401);
  const dispatchUrl = Deno.env.get("KAGGLE_DISPATCH_URL");
  const dispatchSecret = Deno.env.get("KAGGLE_DISPATCH_SECRET");
  if (!dispatchUrl || !dispatchSecret) return json({ error: "Kaggle dispatcher is not configured" }, 503);
  const jobs = await db.from("rg_processing_jobs").select("id,survey_id,status,kaggle_kernel_ref,updated_at,result_manifest").in("status", ["Submitting", "Running", "Validating results"]).order("updated_at").limit(10);
  if (jobs.error) return json({ error: jobs.error.message }, 500);
  const report = [];
  for (const job of jobs.data || []) {
    if (!job.kaggle_kernel_ref) continue;
    const body = JSON.stringify({ action: "status", kernel_ref: job.kaggle_kernel_ref });
    try {
      const response = await fetch(dispatchUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-RiceGuard-Signature": await signature(dispatchSecret, body) }, body });
      if (!response.ok) continue;
      const provider = await response.json();
      const state = String(provider.status || provider.state || "").toLowerCase();
      if (["error", "failed", "cancelled"].includes(state)) {
        await db.from("rg_processing_jobs").update({ status: "Failed", error: `Kaggle run ended with status ${state}`, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
        await db.from("rg_surveys").update({ status: "Failed", stage_updated_at: new Date().toISOString() }).eq("id", job.survey_id);
      } else if (["complete", "completed"].includes(state) && !job.result_manifest) {
        const stale = Date.now() - new Date(job.updated_at).getTime() > 15 * 60_000;
        if (stale) {
          await db.from("rg_processing_jobs").update({ status: "Failed", error: "Kaggle completed without a verified worker result callback", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
          await db.from("rg_surveys").update({ status: "Failed", stage_updated_at: new Date().toISOString() }).eq("id", job.survey_id);
        } else {
          await db.from("rg_processing_jobs").update({ status: "Validating results", updated_at: new Date().toISOString() }).eq("id", job.id);
          await db.from("rg_surveys").update({ status: "Validating results", stage_updated_at: new Date().toISOString() }).eq("id", job.survey_id);
        }
      }
      report.push({ job_id: job.id, kaggle_status: state });
    } catch {
      // Leave running jobs unchanged when status reconciliation itself is unavailable.
    }
  }
  return json({ checked: report.length, jobs: report });
});
