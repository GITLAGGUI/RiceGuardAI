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
  error: "May error; uulitin",
};

function describe(step: PipelineStep) {
  const d = step.detail || {};
  if (step.step === "severity" && typeof d.overall === "string") return `Kabuuan: ${d.overall}`;
  if (step.step === "location" && typeof d.label === "string") return d.label;
  if (step.step === "advisory") return `${d.mode === "ollama" ? `${d.model}` : "approved template"} · ${(d.sources as unknown[] | undefined)?.length ?? 0} source`;
  if (step.step === "published") return `${d.recipients ?? 0} magsasaka ang padadalhan ng SMS`;
  if (step.status === "failed" && typeof d.error === "string") return d.error;
  return "";
}

export function PipelineTimeline({ surveyId }: { surveyId: string }) {
  const { data } = useOperations();
  const steps = (data.pipeline_steps || []).filter((s) => s.survey_id === surveyId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-12);
  if (!steps.length) return null;
  return (
    <section className="rg-panel rg-timeline" aria-label="Automation timeline">
      <h3><Activity size={16} /> Automation</h3>
      <ol>
        {steps.map((step) => (
          <li key={step.id} className={`is-${step.status}`}>
            {step.status === "failed" ? <CircleAlert size={15} /> : step.status === "running" ? <Loader2 size={15} /> : <Check size={15} />}
            <span><b>{STEP_LABEL[step.step] || step.step}</b>{describe(step) ? <small>{describe(step)}</small> : null}</span>
            <time>{new Date(step.created_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</time>
          </li>
        ))}
      </ol>
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
              <span className="rg-live-name"><b>{survey.name}</b><small>{survey.place?.label || survey.location}</small></span>
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
