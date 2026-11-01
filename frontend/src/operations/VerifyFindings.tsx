import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, CircleAlert, CircleHelp, ExternalLink, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { useOperations } from "./store";
import { DiseasePhoto, DISEASE_COLORS } from "./DiseasePhoto";
import { VerificationBadge } from "./VerificationBadge";
import { PipelineTimeline } from "./PipelineMonitor";
import { PhotoClassBars } from "./PhotoClassBars";
import type { Disease, Survey } from "./domain";

type Finding = { key: string; assetId: string; disease: Disease; kind: "image" | "video"; photo: number; percent: number | null };
type Decision = { decision?: "accepted" | "rejected" | "uncertain"; reason?: string; note?: string };

const REASONS: Array<[string, string]> = [
  ["healthy", "Walang sakit sa larawan"],
  ["dry_leaf", "Tuyong dahon lang, hindi sakit"],
  ["soil_nitrogen", "Kulay dahil sa nitrogen ng lupa, hindi sakit"],
  ["other_disease", "Ibang sakit ang nakikita"],
  ["unclear", "Malabo / hindi makita nang maayos"],
  ["other", "Iba pa (pakisulat)"],
];
// "Hindi sigurado" keeps the finding on record but out of the post, severity and SMS.
const UNCERTAIN_REASONS: Array<[string, string]> = [
  ["dry_leaf", "Baka tuyong dahon lang"],
  ["soil_nitrogen", "Baka dahil sa nitrogen ng lupa"],
  ["unclear", "Malabo / kailangan ng field check"],
  ["other", "Iba pa (pakisulat)"],
];
const needsReason = (d?: Decision) => d?.decision === "rejected" || d?.decision === "uncertain";
const LEVEL: Record<string, string> = { low: "Mababa", moderate: "Katamtaman", high: "Mataas" };

function queueState(survey: Survey) {
  if (survey.status === "Needs review") return "verify";
  if (survey.status === "Reviewed") return "done";
  return "processing";
}

/** One screen per survey: every AI finding gets "Tama" or "Mali". Everything else is automatic. */
export function VerifyWorkspace() {
  const { data, operation, refresh } = useOperations();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<"verify" | "done" | "all">("verify");
  const surveys = useMemo(() => data.surveys.filter((s) => tab === "all" || queueState(s) === tab), [data.surveys, tab]);
  const selectedId = params.get("survey") || surveys[0]?.id || "";
  const survey = data.surveys.find((s) => s.id === selectedId);
  const job = data.jobs.find((j) => j.survey_id === selectedId && j.result_manifest);
  const bulletin = data.bulletins.find((b) => b.survey_id === selectedId && b.result_revision === survey?.active_result_revision);
  const urls = job?.review_urls || {};
  const assetsJson = JSON.stringify(job?.result_manifest?.assets || []);
  const findings = useMemo<Finding[]>(() => {
    const assets = JSON.parse(assetsJson) as Array<{ source_asset_id: string; kind: "image" | "video";
      diseases?: Array<{ disease: Disease; status: string }>; measurements?: { plant_pixels: number; lesion_pixels: Record<Disease, number> } }>;
    let photo = 0;
    return assets.flatMap((asset) => {
      if (asset.kind === "image") photo += 1;
      return (asset.diseases || []).filter((f) => f.status === "detected").map((f) => ({
        key: `${asset.source_asset_id}:${f.disease}`, assetId: asset.source_asset_id, disease: f.disease, kind: asset.kind, photo,
        percent: asset.measurements?.plant_pixels
          ? Math.round(asset.measurements.lesion_pixels[f.disease] / asset.measurements.plant_pixels * 1000) / 10 : null,
      }));
    });
  }, [assetsJson]);
  const savedJson = JSON.stringify(job?.finding_reviews || []);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const saved = JSON.parse(savedJson) as Array<{ source_asset_id: string; disease: string; decision: string; reason?: string; note?: string }>;
    setDecisions(Object.fromEntries(saved.filter((r) => ["accepted", "rejected", "uncertain"].includes(r.decision)).map((r) =>
      [`${r.source_asset_id}:${r.disease}`, { decision: r.decision as Decision["decision"], reason: r.reason || undefined, note: r.note || undefined }])));
  }, [selectedId, savedJson]);

  const complete = findings.length > 0 && findings.every((f) => {
    const d = decisions[f.key];
    return d?.decision === "accepted" || (needsReason(d) && d!.reason && (d!.reason !== "other" || (d!.note || "").trim().length >= 2));
  });
  const accepted = findings.filter((f) => decisions[f.key]?.decision === "accepted").length;
  const uncertain = findings.filter((f) => decisions[f.key]?.decision === "uncertain").length;
  const classOf = (assetId: string) => data.assets.find((a) => a.id === assetId)?.classification || null;
  const set = (key: string, change: Decision) => setDecisions((current) => ({ ...current, [key]: { ...current[key], ...change } }));

  const save = async () => {
    if (!survey || !complete) return;
    setBusy(true);
    try {
      await operation("verify-findings", { id: survey.id, reviews: findings.map((f) => ({ source_asset_id: f.assetId, disease: f.disease,
        decision: decisions[f.key].decision, reason: decisions[f.key].reason, note: decisions[f.key].note })) });
      await refresh();
      toast.success(accepted === findings.length ? "Salamat! Verified na ang post." :
        uncertain && accepted === 0 ? "Na-save. Hindi muna ipo-post ang mga hindi sigurado; babawiin ang post." :
        accepted === 0 ? "Na-save. Babawiin ang post at aabisuhan ang mga nakatanggap ng SMS." :
          "Na-save. Ina-update na ang severity, payo at post.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally { setBusy(false); }
  };
  const act = async (action: string, done: string) => {
    if (!survey) return;
    setBusy(true);
    try { await operation(action, { id: survey.id }); await refresh(); toast.success(done); }
    catch (error) { toast.error((error as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="rg-verify">
      <div className="rg-page-heading">
        <div>
          <h1>I-verify ang mga nakita ng AI</h1>
          <p>Naka-post na ang payo. Markahan ang bawat nakita: <b>Tama</b>, <b>Mali</b> o <b>Hindi sigurado</b>. Ang mali at hindi sigurado ay inaalis sa post, severity at SMS.</p>
        </div>
      </div>
      <div className="rg-verify-layout">
        <nav className="rg-panel rg-verify-queue" aria-label="Survey queue">
          <div className="rg-segment" role="tablist">
            {([["verify", "I-verify"], ["done", "Tapos na"], ["all", "Lahat"]] as const).map(([value, label]) => (
              <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? "selected" : ""} onClick={() => setTab(value)}>
                {label}{value === "verify" ? ` (${data.surveys.filter((s) => queueState(s) === "verify").length})` : ""}
              </button>
            ))}
          </div>
          {surveys.length ? surveys.map((s) => {
            const b = data.bulletins.find((item) => item.survey_id === s.id && item.result_revision === s.active_result_revision);
            return (
              <button key={s.id} className={`rg-verify-item ${s.id === selectedId ? "is-selected" : ""}`}
                onClick={() => setParams({ survey: s.id })}>
                <strong>{s.name}</strong>
                <span>{s.place?.label || s.location}</span>
                <span className="rg-verify-item-meta">
                  {s.severity_detail ? <em className={`rg-sev rg-sev-${s.severity_detail.overall}`}>{LEVEL[s.severity_detail.overall]}</em> : null}
                  {b ? <VerificationBadge status={b.verification_status} size="sm" /> : null}
                  <small>{new Date(s.created_at || s.captured_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</small>
                </span>
              </button>
            );
          }) : <p className="rg-muted">Wala nang kailangang i-verify.</p>}
        </nav>
        {survey ? (
          <section className="rg-verify-detail">
            <header className="rg-panel rg-verify-summary">
              <div className="rg-verify-title">
                <h2>{survey.name.split(" · ")[0]}</h2>
                <p>
                  {survey.place?.label || survey.location}
                  {survey.name.includes(" · ") ? <> · {survey.name.split(" · ").slice(1).join(" · ")}</> : null}
                  {bulletin ? <span className="rg-nowrap"><VerificationBadge status={bulletin.verification_status} size="sm" /></span> : null}
                </p>
              </div>
              {survey.severity_detail ? (
                <ul className="rg-verify-severity" aria-label="Severity">
                  {Object.entries(survey.severity_detail.diseases).map(([d, s]) => (
                    <li key={d}><i style={{ background: DISEASE_COLORS[d as Disease] }} /><b>{d}</b><span>{LEVEL[s!.category]} · {s!.percent}%</span></li>
                  ))}
                </ul>
              ) : null}
              {bulletin?.status === "published" && bulletin.verification_status !== "retracted"
                ? <Link className="rg-button rg-secondary rg-verify-open" to={`/advisories/${bulletin.slug}`} target="_blank"><ExternalLink size={15} /> Tingnan ang post</Link>
                : null}
            </header>
            {survey.status === "Failed" ? (
              <div className="rg-notice rg-notice-error"><CircleAlert size={18} />
                <span>Huminto ang pagproseso ng mga larawan.</span>
                <button className="rg-button rg-secondary" disabled={busy} onClick={() => void act("retry-processing", "Inulit ang pagproseso.")}>
                  <RotateCcw size={15} /> Ulitin</button>
              </div>
            ) : null}
            {survey.auto_status === "failed" ? (
              <div className="rg-notice rg-notice-error"><CircleAlert size={18} />
                <span>Hindi natapos ang automatic na payo: {survey.auto_error}</span>
                <button className="rg-button rg-secondary" disabled={busy} onClick={() => void act("retry-automation", "Inulit ang automation.")}>
                  <RotateCcw size={15} /> Ulitin</button>
              </div>
            ) : null}
            {survey.status === "Needs review" && job && !findings.length ? (
              <div className="rg-panel rg-verify-empty">
                <p>Walang nakitang BLB o Brown Spot ang AI sa {job.result_manifest?.assets ? (job.result_manifest.assets as unknown[]).length : 0} larawan.</p>
                <button className="rg-button rg-primary" disabled={busy} onClick={() => void act("confirm-no-disease", "Kumpirmado: walang sakit.")}>
                  <Check size={16} /> Kumpirmahin</button>
              </div>
            ) : null}
            <div className="rg-verify-grid">
              {findings.map((f) => {
                const d = decisions[f.key] || {};
                const assetUrls = urls[f.assetId] || {};
                const locked = survey.status !== "Needs review" && survey.status !== "Reviewed";
                return (
                  <article key={f.key} className={`rg-panel rg-finding-card is-${d.decision || "pending"}`}>
                    {f.kind === "video" ? (
                      <video src={assetUrls.video} controls playsInline preload="metadata" />
                    ) : (
                      <DiseasePhoto compact original={assetUrls.web_original} layers={{ [f.disease]: assetUrls[`layer_${f.disease}`] }}
                        fallback={assetUrls[f.disease] || assetUrls.combined || assetUrls.original} alt={`Photo ${f.photo}: ${f.disease}`} />
                    )}
                    <div className="rg-finding-body">
                      <p><i style={{ background: DISEASE_COLORS[f.disease] }} /><b>{f.disease}</b>
                        <span>{f.kind === "video" ? "video" : `Larawan ${f.photo}`}{f.percent != null ? ` · ${f.percent}% ng dahon` : ""}</span></p>
                      <div className="rg-yes-no has-maybe" role="group" aria-label={`${f.disease} sa larawan ${f.photo}`}>
                        <button type="button" disabled={locked || busy} className={d.decision === "accepted" ? "is-on yes" : "yes"}
                          onClick={() => set(f.key, { decision: "accepted", reason: undefined, note: undefined })}><Check size={16} /> Tama</button>
                        <button type="button" disabled={locked || busy} className={d.decision === "rejected" ? "is-on no" : "no"}
                          onClick={() => set(f.key, { decision: "rejected", reason: undefined })}><X size={16} /> Mali</button>
                        <button type="button" disabled={locked || busy} className={d.decision === "uncertain" ? "is-on maybe" : "maybe"}
                          onClick={() => set(f.key, { decision: "uncertain", reason: undefined })}><CircleHelp size={15} /> Hindi sigurado</button>
                      </div>
                      {needsReason(d) ? (
                        <select aria-label={d.decision === "uncertain" ? "Bakit hindi sigurado?" : "Bakit mali?"} value={d.reason || ""}
                          onChange={(e) => set(f.key, { reason: e.target.value })}>
                          <option value="" disabled>{d.decision === "uncertain" ? "Bakit hindi sigurado?" : "Bakit mali?"}</option>
                          {(d.decision === "uncertain" ? UNCERTAIN_REASONS : REASONS).map(([value, label]) =>
                            <option key={value} value={value}>{label}</option>)}
                        </select>
                      ) : null}
                      {classOf(f.assetId) ? (
                        <div className="rg-finding-class"><PhotoClassBars compact classification={classOf(f.assetId)!} /></div>
                      ) : null}
                      {needsReason(d) && d.reason === "other" ? (
                        <input aria-label="Pakisulat ang dahilan" placeholder="Pakisulat ang dahilan" maxLength={500}
                          value={d.note || ""} onChange={(e) => set(f.key, { note: e.target.value })} />
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
            {findings.length ? (
              <div className="rg-verify-actions">
                <span>{Object.values(decisions).filter((d) => d.decision).length} / {findings.length} napagpasyahan · {accepted} tama{uncertain ? ` · ${uncertain} hindi sigurado` : ""}</span>
                <button className="rg-button rg-secondary" disabled={busy}
                  onClick={() => setDecisions(Object.fromEntries(findings.map((f) => [f.key, { decision: "accepted" as const }])))}>Lahat tama</button>
                <button className="rg-button rg-primary" disabled={busy || !complete} onClick={() => void save()}>
                  {busy ? "Sine-save…" : "I-save"}</button>
              </div>
            ) : null}
            <PipelineTimeline surveyId={survey.id} />
          </section>
        ) : <section className="rg-panel rg-verify-empty"><p>Pumili ng survey sa listahan.</p></section>}
      </div>
    </div>
  );
}
