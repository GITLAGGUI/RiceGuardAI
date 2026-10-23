import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { Bulletin, Survey } from "./domain";
import { useOperations } from "./store";
import { currentSeverityBulletin, currentSeveritySuggestion, fieldSeverityLabel } from "./severityPresentation";
import { validateSeverityReview } from "../../../supabase/functions/_shared/reviewWorkflow";

type Entry = { disease: string; basis: string; category: string; specialist: string; notes: string; percent: string; samples: string; confirmed: boolean };
function initialEntries(survey: Survey, bulletin?: Bulletin): Entry[] {
  return (bulletin?.diseases || []).map(disease => {
    const saved = survey.field_assessment?.result_revision === bulletin?.result_revision ? survey.field_assessment?.diseases[disease] : undefined;
    return { disease, basis:saved?.basis || "reviewed_visual_estimate", category:saved?.category || "", specialist:saved?.specialist || "", notes:saved?.notes || "",
      percent:saved?.leaf_area_affected_pct?.toString() || "", samples:saved?.sampled_leaves?.toString() || "", confirmed:false };
  });
}
function payload(entry: Entry, revision?: number) {
  return { ...entry, advisory_revision:revision, model_calibrated:false,
    leaf_area_affected_pct:entry.percent.trim() ? Number(entry.percent) : null, sampled_leaves:entry.samples.trim() ? Number(entry.samples) : null };
}
export function SeverityAssessment({ survey, bulletin:requested, onDirtyChange, onSaved }: {
  survey:Survey; bulletin?:Bulletin; onDirtyChange?:(dirty:boolean)=>void; onSaved?:()=>void;
}) {
  const { data, refresh, operation } = useOperations();
  const bulletin = requested || currentSeverityBulletin(survey,data.bulletins);
  const [entries,setEntries] = useState(()=>initialEntries(survey,bulletin));
  const [dirty,setDirty] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const baseRevision = useRef(bulletin?.advisory_revision);
  const stale = dirty && baseRevision.current !== bulletin?.advisory_revision;
  useEffect(()=>{ if (!dirty) {baseRevision.current=bulletin?.advisory_revision;setEntries(initialEntries(survey,bulletin));} },[dirty,bulletin,survey]);
  const update = (index:number,changes:Partial<Entry>) => {
    setEntries(rows=>rows.map((row,i)=>i===index ? {...row,...changes,confirmed:changes.confirmed ?? false} : row));
    setDirty(true); onDirtyChange?.(true); setError("");
  };
  let invalid="";
  try { validateSeverityReview(entries.map(entry=>payload(entry,bulletin?.advisory_revision))); } catch(e) { invalid=(e as Error).message; }
  const reviewed=survey.status==="Reviewed" && survey.active_result_revision===survey.approved_result_revision && !!entries.length;
  if (!reviewed) return <section className="rg-review-card" role="status"><h2>Review severity</h2><p>Approve the current images and accepted findings first. A processing result is not a severity grade.</p></section>;
  if (bulletin?.status==="published") return <section className="rg-review-card"><h2>Published severity review</h2>
    {!survey.field_assessment ? <p>Existing public summary: {fieldSeverityLabel(bulletin.severity)}. No per-disease assessment was recorded; no new grade has been assigned here.</p> : null}
    {entries.map(row=><p key={row.disease}><strong>{row.disease}</strong> · {fieldSeverityLabel(row.category as Survey["severity"])}{row.specialist ? " · "+row.specialist : ""}</p>)}
    <p>This public record is protected. Create a correction before changing it.</p>
    <Link to={"/admin/review?survey="+survey.id+"&advisory="+bulletin.id+"&step=severity"}>Open this survey’s review</Link></section>;
  return <section className="rg-review-card" aria-labelledby="severity-title">
    <h2 id="severity-title">Review severity</h2><p>Review every accepted disease, then save once. A visual estimate describes the reviewed images—not measured damage across the whole farm.</p>
    <p className="rg-muted">No usable estimate? Record “Severity not assessed” with your reason. It stays unassessed on the map.</p>
    {stale ? <div className="rg-notice" role="alert">This advisory changed in another tab. Your entries are retained but cannot overwrite the newer revision.
      <button type="button" onClick={()=>{setEntries(initialEntries(survey,bulletin));setDirty(false);onDirtyChange?.(false);baseRevision.current=bulletin?.advisory_revision;}}>Discard my entries and reload</button></div> : null}
    {entries.map((entry,index)=>{
      const suggestion=currentSeveritySuggestion(survey,bulletin,entry.disease);
      return <fieldset key={entry.disease} disabled={busy} className="rg-review-disease"><legend>{entry.disease}</legend>
        <label>Assessment method<select value={entry.basis} onChange={e=>update(index,{basis:e.target.value,category:e.target.value==="not_assessed" ? "not_assessed" : ""})}>
          <option value="reviewed_visual_estimate">Review images / visual estimate</option><option value="manual_field_assessment">Independent leaf measurements</option><option value="not_assessed">Severity not assessed</option></select></label>
        {entry.basis==="reviewed_visual_estimate" ? <div role="status" className="rg-severity-suggestion"><strong>AI suggestion: {suggestion && ["low","moderate","high"].includes(suggestion.category) ? fieldSeverityLabel(suggestion.category) : "Not estimable"}</strong>
          <p>{suggestion?.reason || "No current image-based suggestion. Record your own reviewed estimate or choose not assessed."}</p>
          {suggestion && ["low","moderate","high"].includes(suggestion.category) ? <button type="button" className="rg-button rg-secondary" onClick={()=>update(index,{category:suggestion.category,notes:suggestion.reason})}>Use suggestion for {entry.disease}</button> : null}</div> : null}
        {entry.basis==="manual_field_assessment" ? <><p>Lesion area ÷ independently sampled leaf area × 100. Whole affected-leaf masks are not lesion measurements.</p>
          <label>Measured damaged leaf area (%)<input type="number" min="0" max="100" step="0.1" value={entry.percent} onChange={e=>update(index,{percent:e.target.value})}/></label>
          {!entry.percent.trim() || !Number.isFinite(Number(entry.percent)) || Number(entry.percent)<0 || Number(entry.percent)>100 ? <small>Enter a measured value from 0 to 100.</small> : null}
          <label>Leaves independently sampled<input type="number" min="1" max="10000" step="1" value={entry.samples} onChange={e=>update(index,{samples:e.target.value})}/></label>
          {!Number.isInteger(Number(entry.samples)) || Number(entry.samples)<1 || Number(entry.samples)>10000 ? <small>Enter a whole-number sample count from 1 to 10,000.</small> : null}</> : null}
        {entry.basis!=="not_assessed" ? <label>Reviewed damage grade<select value={entry.category} onChange={e=>update(index,{category:e.target.value})}><option value="">Choose after reviewing</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">Severe</option></select></label> : null}
        <label>Approving reviewer<input maxLength={120} value={entry.specialist} onChange={e=>update(index,{specialist:e.target.value})} aria-invalid={entry.specialist.trim().length<2}/></label>
        {entry.specialist.trim().length<2 ? <small>Reviewer name: at least 2 characters.</small> : null}
        <label>{entry.basis==="not_assessed" ? "Why could severity not be assessed?" : "What did you review or measure?"}<textarea maxLength={2000} value={entry.notes} onChange={e=>update(index,{notes:e.target.value})} aria-invalid={entry.notes.trim().length<20}/></label>
        <small>{entry.notes.trim().length}/20 minimum characters. Explain the limits or your scoring method.</small>
        <label className="rg-check"><input type="checkbox" checked={entry.confirmed} onChange={e=>update(index,{confirmed:e.target.checked})}/>I reviewed and confirm this {entry.disease} outcome.</label>
      </fieldset>;
    })}
    {error ? <p role="alert" className="rg-notice rg-notice-error">{error}</p> : null}
    <button type="button" className="rg-button rg-primary" disabled={busy || !!invalid || stale || !dirty} onClick={async()=>{
      if (!bulletin || busy) return;setBusy(true);setError("");
      try { const response=await operation("save-severity-review",{id:bulletin.id,result_revision:survey.active_result_revision,advisory_revision:baseRevision.current,entries:entries.map(row=>payload(row,baseRevision.current))});
        baseRevision.current=response.advisory_revision;setDirty(false);onDirtyChange?.(false);await refresh();onSaved?.();toast.success("Severity review saved for every accepted disease.");
      } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
    }}>{busy ? "Saving severity review…" : "Save severity review"}</button>
    <p className="rg-disabled-reason" role="status">{stale ? "Reload before saving." : invalid || (!dirty ? "Saved outcomes are shown above. Make changes only if needed." : "Ready to save all disease outcomes together.")}</p>
  </section>;
}
