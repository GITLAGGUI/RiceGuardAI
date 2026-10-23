import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { awsSettings, signedAwsPost } from "../_shared/awsSigV4.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body),
  { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("AWS_CRON_SECRET") || Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) return json({ error: "Unauthorized" }, 401);
  let settings;
  try { settings = awsSettings(); } catch { return json({ status: "unconfigured" }, 503); }
  const input = await req.json().catch(() => ({}));
  if (input.probe === true) {
    const response = await signedAwsPost(JSON.stringify({ action: "probe",
      job_id: "00000000-0000-4000-8000-000000000000", run_id: "probe" }), settings);
    return json({ controller_http_status: response.status,
      signature_verified: response.status === 400 });
  }
  const jobs = await db.from("rg_processing_jobs")
    .select("id,run_id,survey_id,status,aws_job_ref,updated_at")
    .eq("provider", "aws").in("status", ["Submitting", "Running", "Validating results"])
    .order("updated_at").limit(10);
  if (jobs.error) return json({ error: "Could not load private jobs" }, 500);
  const report: Array<{ job_id: string; state: string }> = [];
  for (const job of jobs.data || []) {
    if (!job.aws_job_ref) {
      // No receipt can mean an interrupted external submit. Never retry it
      // blindly or call it a failed model result.
      report.push({ job_id: job.id, state: "receipt_requires_reconciliation" });
      continue;
    }
    try {
      const response = await signedAwsPost(JSON.stringify({ action: "status", job_id: job.id,
        run_id: job.run_id }), settings);
      if (!response.ok) continue;
      const provider = await response.json();
      const state = String(provider.status || "").toLowerCase();
      if (provider.job_ref !== job.aws_job_ref) continue;
      if (["succeeded", "failed"].includes(state) && provider.callback_delivered !== true) {
        report.push({ job_id: job.id, state: "callback_pending" });
        continue;
      }
      if (["submitted", "pending", "runnable", "starting", "running"].includes(state)) {
        await db.from("rg_processing_jobs").update({ status: "Running",
          updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "Submitting");
      }
      report.push({ job_id: job.id, state });
    } catch {
      // External status failure does not prove that model inference failed.
    }
  }
  return json({ checked: report.length, jobs: report });
});
