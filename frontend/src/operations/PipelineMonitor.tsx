// GABAY: Timeline ng automation (Upload -> GPU -> Resulta -> Advisory -> SMS) at gaano katagal ang bawat yugto.
import "./operations.css";
import "./bulletin.css";
import { Link } from "react-router-dom";
import { Activity, Check, CircleAlert, Loader2 } from "lucide-react";
import { useOperations } from "./store";
import type { PipelineStep, Survey } from "./domain";

const STEP_LABEL: Record<string, string> = {
  start: "Sinimulan ang automation",
  verify_start: "Inilapat ang pasya ng specialist",
  severity: "Na-compute ang severity",
  location: "Natukoy ang barangay",
  media: "Inihanda ang mga larawan",
  advisory: "Isinulat ang payo",
  advisory_llm: "Hindi sumagot ang AI; uulitin",
  published: "Na-post at naka-queue ang SMS",
  verified: "Na-verify ang post",
  retracted: "Binawi ang post",
  no_disease: "Walang nakitang sakit",
  error: "May error",
};

function describe(step: PipelineStep) {
  const d = step.detail || {};
  if (step.step === "severity" && typeof d.overall === "string") return `Kabuuan: ${d.overall}`;
  if (step.step === "location" && typeof d.label === "string") return d.label;
  if (step.step === "advisory") return `${d.mode === "ollama" ? `${d.model}` : "approved template"} · ${(d.sources as unknown[] | undefined)?.length ?? 0} source`;
  if (step.step === "published") return `${d.recipients ?? 0} magsasaka ang padadalhan ng SMS`;
  if (step.status === "failed" && typeof d.error === "string")
    return `${d.error}${typeof d.retry_in_seconds === "number" ? ` · uulitin sa ${d.retry_in_seconds} s` : ""}`;
  return "";
}

const seconds = (from?: string | null, to?: string | null) =>
  from && to ? Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000) : null;
export const duration = (value: number | null) => value == null ? "—"
  : value < 60 ? `${Math.round(value)} s` : value < 3600 ? `${Math.floor(value / 60)} min ${Math.round(value % 60)} s`
  : `${Math.floor(value / 3600)} h ${Math.round((value % 3600) / 60)} min`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

/** Upload → queue → GPU → post, from the job's own timestamps. */
export function StageTimings({ survey }: { survey: Survey }) {
  const { data } = useOperations();
  const job = data.jobs.find((j) => j.survey_id === survey.id && j.result_manifest) || data.jobs.find((j) => j.survey_id === survey.id);
  const steps = (data.pipeline_steps || []).filter((s) => s.survey_id === survey.id);
  const published = steps.find((s) => s.step === "published" && s.status === "done");
  if (!job) return null;
  const cells: Array<[string, number | null, string]> = [
    ["Upload", seconds(survey.created_at, job.created_at), "mula sa pagbukas ng survey hanggang sa huling larawan"],
    ["Pila sa Kaggle", seconds(job.dispatched_at || job.created_at, job.started_at), "naghihintay ng libreng GPU"],
    ["GPU", seconds(job.started_at, job.completed_at), "pagsusuri ng BLB at Brown Spot"],
    ["Payo at post", seconds(job.completed_at, published?.created_at), "severity, lugar, larawan, payo"],
  ];
  const total = seconds(survey.created_at, published?.created_at);
  return (
    <dl className="rg-stage-timings" aria-label="Tagal ng bawat yugto">
      {cells.map(([label, value, hint]) => <div key={label} title={hint}><dt>{label}</dt><dd>{duration(value)}</dd></div>)}
      <div className="is-total"><dt>Kabuuan</dt><dd>{duration(total)}</dd></div>
    </dl>
  );
}

type Run = { label: string; steps: PipelineStep[] };
function runsOf(steps: PipelineStep[]): Run[] {
  const runs: Run[] = [];
  for (const step of steps) {
    if (step.step === "start" || step.step === "verify_start" || !runs.length) {
      const verify = step.step === "verify_start";
      const count = runs.filter((run) => run.label.startsWith(verify ? "Pagkatapos" : "Unang")).length;
      runs.push({ label: verify ? `Pagkatapos ng specialist${count ? ` (${count + 1})` : ""}` : count ? `Ulit ${count + 1}` : "Unang pasada", steps: [] });
    }
    runs[runs.length - 1].steps.push(step);
  }
  return runs;
}

export function PipelineTimeline({ surveyId }: { surveyId: string }) {
  const { data } = useOperations();
  const survey = data.surveys.find((s) => s.id === surveyId);
  const steps = (data.pipeline_steps || []).filter((s) => s.survey_id === surveyId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!steps.length && !survey) return null;
  const runs = runsOf(steps).slice(-3);
  return (
    <section className="rg-panel rg-timeline" aria-label="Automation timeline">
      <header>
        <h3><Activity size={16} /> Automation</h3>
        {survey ? <StageTimings survey={survey} /> : null}
      </header>
      <div className="rg-runs">
        {runs.map((run, index) => {
          const first = run.steps[0];
          const last = run.steps[run.steps.length - 1];
          const failed = run.steps.some((s) => s.status === "failed");
          return (
            <article key={`${run.label}-${index}`} className={`rg-run ${failed ? "has-error" : ""}`}>
              <h4>{run.label}<span>{clock(first.created_at)} · {duration(seconds(first.created_at, last.created_at))}</span></h4>
              <ol>
                {run.steps.filter((step) => step.step !== "start" && step.step !== "verify_start").map((step, i, list) => (
                  <li key={step.id} className={`is-${step.status}`}>
                    {step.status === "failed" ? <CircleAlert size={14} /> : step.status === "running" ? <Loader2 size={14} /> : <Check size={14} />}
                    <span><b>{STEP_LABEL[step.step] || step.step}</b>{describe(step) ? <small>{describe(step)}</small> : null}</span>
                    <time>{i ? `+${duration(seconds(list[i - 1].created_at, step.created_at))}` : clock(step.created_at)}</time>
                  </li>
                ))}
              </ol>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const STAGES = ["Upload", "GPU", "Severity", "Payo", "Post", "SMS"] as const;

function stageIndex(survey: Survey, steps: PipelineStep[]) {
  if (["Awaiting upload", "Validating"].includes(survey.status)) return 0;
  if (["Queued", "Submitting", "Waiting for GPU", "Waiting for allowance", "Running", "Validating results"].includes(survey.status)) return 1;
  const done = new Set(steps.filter((s) => s.status === "done").map((s) => s.step));
  if (done.has("published") || done.has("verified") || done.has("retracted")) return 5;
  if (done.has("advisory")) return 4;
  if (done.has("severity")) return 3;
  return 2;
}

/** Live view of every recent survey moving through the automation (updates over Realtime). */
export function LivePipeline() {
  const { data } = useOperations();
  const recent = data.surveys.slice(0, 6);
  if (!recent.length) return null;
  return (
    <section className="rg-panel rg-live-pipeline" aria-label="Live pipeline">
      <header><h2><span className="rg-live-dot" aria-hidden /> Live pipeline</h2><Link to="review">Buksan ang verification</Link></header>
      <ul>
        {recent.map((survey) => {
          const steps = (data.pipeline_steps || []).filter((s) => s.survey_id === survey.id);
          const index = stageIndex(survey, steps);
          const failed = survey.status === "Failed" || survey.auto_status === "failed";
          return (
            <li key={survey.id}>
              <span className="rg-live-name"><b>{survey.name.split(" · ")[0]}</b><small>{survey.place?.label || survey.location}</small></span>
              <ol className="rg-live-stages" aria-label={`Stage ${STAGES[index]}`}>
                {STAGES.map((stage, i) => (
                  <li key={stage} className={i < index || (i === index && index === 5) ? "is-done" : i === index ? failed ? "is-failed" : "is-active" : ""}>{stage}</li>
                ))}
              </ol>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
