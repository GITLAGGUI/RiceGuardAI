import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useBlocker, useSearchParams } from "react-router-dom";
import { FieldMap } from "./LazyMap";
import { SeverityAssessment } from "./SeverityAssessment";
import { useOperations } from "./store";
import type { Bulletin, Survey } from "./domain";
import type { Readiness, ReviewStep } from "../../../supabase/functions/_shared/reviewWorkflow";
import { validReviewCoordinates } from "../../../supabase/functions/_shared/reviewWorkflow";
import { advisoryActionSteps } from "./advisoryPresentation";
import { fieldSeverityLabel } from "./severityPresentation";

const steps: ReviewStep[] = ["images","severity","location","publish"];
const labels = ["Review images","Review severity","Confirm location","Preview & publish"];
export function reviewHref(survey: string, advisory?: string, step: ReviewStep="images") {
  return `/admin/review?${new URLSearchParams({survey,...(advisory ? {advisory} : {}),step})}`;
}
export function ReviewJourney({survey,bulletin,children,imageDirty=false,onDiscardImages}: {
  survey?:Survey; bulletin?:Bulletin; children:ReactNode; imageDirty?:boolean; onDiscardImages?:()=>void;
}) {
  const {refresh,operation}=useOperations();
  const [params,setParams]=useSearchParams();
  const requested=params.get("step");
  const step=steps.includes(requested as ReviewStep) ? requested as ReviewStep : "images";
  const [dirty,setDirty]=useState(false);
  const [readiness,setReadiness]=useState<Readiness|null>(null);
  const [error,setError]=useState("");
  const [reload,setReload]=useState(0);
  const [reason,setReason]=useState("");
  const [correcting,setCorrecting]=useState(false);
  const [busy,setBusy]=useState(false);
  const bulletinId=bulletin?.id,advisoryRevision=bulletin?.advisory_revision;
  const blocker=useBlocker(dirty || imageDirty);
  useEffect(()=>{const wake=()=>setReload(n=>n+1);window.addEventListener("focus",wake);return()=>window.removeEventListener("focus",wake);},[]);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(blocker.state==="blocked")dialog.current?.showModal();else dialog.current?.close();},[blocker.state]);
  useEffect(()=>{
    if (!dirty && !imageDirty) return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[dirty,imageDirty]);
  useEffect(()=>{
    let cancelled=false;setReadiness(null);setError("");
    if (bulletinId) operation("review-readiness",{id:bulletinId}).then((r:Readiness)=>{
      if (!cancelled && r.bulletin_id===bulletinId) {
        if (r.advisory_revision!==advisoryRevision) {setError("This record changed. Refresh the workspace before continuing.");return;}
        setReadiness(r);
      }
    }).catch(e=>{if(!cancelled)setError((e as Error).message);});
    return()=>{cancelled=true;};
  },[bulletinId,advisoryRevision,operation,survey?.stage_updated_at,reload]);
  const go=(next:ReviewStep)=>setParams(current=>{
    const copy=new URLSearchParams(current);copy.set("step",next);if(survey)copy.set("survey",survey.id);if(bulletin)copy.set("advisory",bulletin.id);return copy;
  });
  const published=bulletin?.status==="published";
  const historical=published && bulletin.result_revision!==survey?.active_result_revision;
  const current=readiness?.steps.find(row=>row.step===step);
  return <section className="rg-review-journey">
    <header className="rg-journey-heading"><div><span className="rg-eyebrow">ONE SURVEY · ONE REVIEW</span><h1>Review and publish</h1>
      <p>{survey ? `${survey.name} · ${new Date(survey.captured_at).toLocaleDateString("en-PH")} · ${survey.id.slice(0,8)}` : "Select a survey to begin."}</p></div>
      <span className="rg-badge">{published ? "Published · protected" : survey?.status || "No survey"}</span></header>
    <nav className="rg-journey-steps" aria-label="Survey review steps">{steps.map((name,index)=><button key={name} type="button" aria-label={`${index+1}. ${labels[index]}. ${published ? "View" : readiness?.steps.find(row=>row.step===name)?.complete ? "Reviewed" : "To review"}`} aria-current={step===name ? "step" : undefined}
      className={step===name ? "active" : ""} disabled={name!=="images" && (survey?.status!=="Reviewed" || !bulletin)} onClick={()=>go(name)}>
      <span>{index+1}</span>{labels[index]}<small>{published ? "View" : readiness?.steps.find(row=>row.step===name)?.complete ? "Reviewed" : "To review"}</small></button>)}</nav>
    <dialog ref={dialog} className="rg-review-card rg-unsaved-dialog" aria-labelledby="unsaved-review-title" onCancel={e=>{e.preventDefault();if(blocker.state==="blocked")blocker.reset();}}><h2 id="unsaved-review-title">Keep your unsaved changes?</h2><p>Your review has not been saved. Stay here or discard these entries to leave.</p>
      <button className="rg-button rg-primary" onClick={()=>{if(blocker.state==="blocked")blocker.reset();}}>Stay and review</button><button className="rg-button rg-secondary" onClick={()=>{setDirty(false);onDiscardImages?.();if(blocker.state==="blocked")blocker.proceed();}}>Discard and leave</button></dialog>
    {published ? <div className="rg-review-card"><p>This advisory is already public. Changes require a correction; the current public post remains visible until the correction is reviewed and published.</p>
      <Link className="rg-button rg-secondary" to={`/advisories/${bulletin.slug}`}>View public post</Link>
      {historical ? <p>This post belongs to an earlier result and remains protected. <Link to={reviewHref(survey!.id)}>Review the current result</Link> before preparing a replacement.</p> : <button type="button" className="rg-button rg-secondary" onClick={()=>setCorrecting(true)}>Create correction</button>}
      {correcting ? <div><label>What needs correcting?<textarea value={reason} maxLength={500} onChange={e=>{setReason(e.target.value);setDirty(true);}}/></label>
        <button type="button" className="rg-button rg-primary" disabled={busy || reason.trim().length<10} onClick={async()=>{setBusy(true);setError("");try {await operation("create-correction",{id:bulletin.id,advisory_revision:bulletin.advisory_revision,correction_note:reason});setDirty(false);setCorrecting(false);await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Start correction draft</button><small>Enter at least 10 characters describing the correction.</small></div> : null}</div> : null}
    {error ? <div role="alert" className="rg-notice rg-notice-error">{error}<button type="button" onClick={async()=>{await refresh();setReload(n=>n+1);}}>Refresh review status</button></div> : null}
    {step==="images" ? children : !survey || !bulletin ? <p role="status">This survey’s current advisory is unavailable. Complete image review first.</p>
      : step==="severity" ? <SeverityAssessment key={`${bulletin.id}:${bulletin.result_revision}`} survey={survey} bulletin={bulletin} onDirtyChange={setDirty} onSaved={()=>setReload(n=>n+1)}/>
      : step==="location" ? <ReviewLocation key={`${bulletin.id}:${bulletin.result_revision}`} survey={survey} bulletin={bulletin} onDirtyChange={setDirty} onSaved={()=>setReload(n=>n+1)}/>
      : <ReviewPublication key={`${bulletin.id}:${bulletin.result_revision}`} survey={survey} bulletin={bulletin} readiness={readiness} onDirtyChange={setDirty} onSaved={()=>setReload(n=>n+1)}/>}
    {step!=="publish" ? <footer className="rg-journey-footer"><p role="status">{published ? "Viewing the protected public record." : current?.reason || (error ? "Status unavailable. No publication is enabled." : "Checking this survey’s review status…")}</p>
      <button type="button" className="rg-button rg-primary" disabled={!bulletin || dirty || imageDirty || (!published && !current?.complete)} onClick={()=>go(steps[steps.indexOf(step)+1])}>Continue to {labels[steps.indexOf(step)+1].toLowerCase()}</button></footer> : null}
  </section>;
}

export function ReviewLocation({survey,bulletin,onDirtyChange,onSaved}:{survey:Survey;bulletin:Bulletin;onDirtyChange:(dirty:boolean)=>void;onSaved:()=>void}) {
  const {refresh,operation}=useOperations();
  const [lat,setLat]=useState(survey.lat?.toString() || "");const [lng,setLng]=useState(survey.lng?.toString() || "");
  const [mode,setMode]=useState(bulletin.location_review?.mode || "");const [confirmed,setConfirmed]=useState(false);
  const [dirty,setDirty]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const [location,setLocation]=useState(survey.location);
  const base=useRef(bulletin.advisory_revision);const stale=dirty && base.current!==bulletin.advisory_revision;
  useEffect(()=>{if(!dirty){base.current=bulletin.advisory_revision;setLat(survey.lat?.toString()||"");setLng(survey.lng?.toString()||"");setLocation(survey.location);setMode(bulletin.location_review?.mode||"");}},[dirty,bulletin.advisory_revision,bulletin.location_review?.mode,survey.lat,survey.lng,survey.location]);
  const change=()=>{setDirty(true);onDirtyChange(true);setConfirmed(false);setError("");};
  const coordsValid=!!lat.trim() && !!lng.trim() && validReviewCoordinates(Number(lat),Number(lng));
  if(bulletin.status==="published")return <section className="rg-review-card"><h2>Published location</h2><p>{bulletin.public_location_approved && survey.lat!=null ? "Approved approximate public area. Exact farm coordinates remain private." : "Published without a public map pin."}</p><p>Create a correction above to change the location.</p></section>;
  return <section className="rg-review-card"><h2>Confirm location</h2><p>A private survey pin does not publish a post. Public map coordinates are rounded to an approximate area only.</p>
    <FieldMap onPick={(a,b)=>{setLat(a.toFixed(6));setLng(b.toFixed(6));change();}} points={coordsValid ? [{id:survey.id,name:survey.name,lat:Number(lat),lng:Number(lng),severity:"unknown",location:survey.location}] : []}/>
    <div className="rg-coordinate-fields"><label>Private latitude<input type="number" step="any" value={lat} onChange={e=>{setLat(e.target.value);change();}}/></label><label>Private longitude<input type="number" step="any" value={lng} onChange={e=>{setLng(e.target.value);change();}}/></label></div>
    <label>Reviewed area label<input value={location} maxLength={240} onChange={e=>{setLocation(e.target.value);change();}}/></label><small>Use an approximate barangay or municipality label, not a farmer’s name or exact address.</small>
    <p className="rg-muted">Tap the map or enter coordinates. The server checks the actual Region II boundary, not only the map’s rectangular view.</p>
    <label>Public location choice<select value={mode} onChange={e=>{setMode(e.target.value);change();}}><option value="">Choose explicitly</option><option value="approximate_pin">Approve approximate public map pin</option><option value="no_pin">Publish without map pin</option></select></label>
    {mode==="no_pin" ? <p className="rg-notice">The advisory can appear in the bulletin but will not have a public map marker. Existing private coordinates are retained.</p> : null}
    {mode==="approximate_pin" && !coordsValid ? <p role="status">Enter a valid latitude and longitude before saving a map pin.</p> : null}
    <label className="rg-check"><input type="checkbox" checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);setDirty(true);onDirtyChange(true);}}/>I reviewed this location and its public visibility.</label>
    {stale ? <p role="alert">This record changed. Your entries are retained. Leave without saving and reopen this step to review the newer record.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" className="rg-button rg-primary" disabled={busy || stale || !confirmed || !mode || location.trim().length<2 || (mode==="approximate_pin" && !coordsValid) || ((!!lat.trim() || !!lng.trim()) && !coordsValid)} onClick={async()=>{
      if(busy)return;setBusy(true);setError("");try {const response=await operation("save-location",{id:bulletin.id,advisory_revision:base.current,choice:{mode,location,confirmed:true,...(coordsValid ? {lat:Number(lat),lng:Number(lng)} : {})}});
        base.current=response.advisory_revision;setDirty(false);onDirtyChange(false);setConfirmed(false);await refresh();onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
    }}>{busy ? "Saving location…" : "Save location choice"}</button>
    <p role="status">{confirmed ? "Saving confirms the pin choice; it does not publish anything." : "Choose public visibility and check the confirmation to save."}</p>
  </section>;
}

export function ReviewPublication({survey,bulletin,readiness,onDirtyChange,onSaved}:{survey:Survey;bulletin:Bulletin;readiness:Readiness|null;onDirtyChange:(dirty:boolean)=>void;onSaved:()=>void}) {
  const {data,saveDraft,publish,generateAdvisory,operation}=useOperations();
  const [title,setTitle]=useState(bulletin.title);const [body,setBody]=useState(bulletin.body);const [action,setAction]=useState(bulletin.action);
  const [dirty,setDirty]=useState(false);const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const [success,setSuccess]=useState<{public_path?:string;map_eligible?:boolean}|null>(null);
  const [sources,setSources]=useState<{id:string;title:string;disease:string;source_reference:string}[]>([]);
  const [sourcesReady,setSourcesReady]=useState(false);
  const inFlight=useRef(false);
  const base=useRef(bulletin.advisory_revision);const stale=dirty && base.current!==bulletin.advisory_revision;
  const published=bulletin.status==="published";
  const locationLabel=published ? readiness ? readiness.map_eligible ? "Approximate public location only" : "No public map pin" : "Checking published location"
    : bulletin.location_review?.mode==="no_pin" ? "No public map pin" : bulletin.location_review?.mode==="approximate_pin" ? "Approximate public location only" : "Location choice not reviewed";
  const severityLabel=(d:string)=>{
    const assessment=survey.field_assessment;
    const entry=assessment && assessment.result_revision===bulletin.result_revision && (!assessment.bulletin_id || assessment.bulletin_id===bulletin.id)
      && (published || readiness?.steps.some(s=>s.step==="severity" && s.complete)) ? assessment.diseases[d] : undefined;
    const category=entry?.category;
    if(category==="low" || category==="moderate" || category==="high" || category==="not_assessed")return `${category==="not_assessed" ? "Not assessed" : fieldSeverityLabel(category)} · reviewed outcome, not model calibration`;
    if(published && bulletin.reviewer && ["low","moderate","high"].includes(bulletin.severity))return `${fieldSeverityLabel(bulletin.severity)} · legacy reviewed qualitative grade`;
    return published ? "Not assessed · no per-disease review recorded" : "No recorded severity review";
  };
  const job=data.jobs.find(j=>j.survey_id===survey.id && j.result_manifest);
  const privateAssets=job?.result_manifest?.schema_version==="riceguard.result.v2" ? (job.result_manifest.assets || []) as {source_asset_id:string;kind:string;diseases?:{disease:string;status:string}[]}[] : null;
  const privateMedia=privateAssets?.flatMap(asset=>{
    const accepted=(job?.finding_reviews || []).filter(r=>r.source_asset_id===asset.source_asset_id && r.decision==="accepted" && bulletin.diseases?.includes(r.disease) && asset.diseases?.some(d=>d.disease===r.disease && d.status==="detected"));
    if(!accepted.length || asset.kind==="telemetry_sidecar")return [];
    const variant=asset.kind==="video" ? "publication" : accepted.length===2 ? "combined" : accepted[0].disease;
    return [{url:job?.review_urls?.[asset.source_asset_id]?.[variant] || "",alt:`${accepted.map(a=>a.disease).join(" and ")} approved ${asset.kind} preview`,type:asset.kind==="video" ? "video" as const : "image" as const}];
  });
  const media=(!published && privateMedia!==null && privateMedia!==undefined) ? privateMedia : bulletin.public_media?.length ? bulletin.public_media : bulletin.media?.length ? bulletin.media : bulletin.image ? [{url:bulletin.image,alt:"Approved survey preview",type:"image" as const}] : [];
  const [loaded,setLoaded]=useState<Record<string,boolean>>({});
  const [mediaFailed,setMediaFailed]=useState(false);
  const mediaKey=media.map(m=>m.url).join("|");
  useEffect(()=>{setLoaded({});setMediaFailed(false);setConfirmed(false);},[mediaKey]);
  const mediaReady=media.length>0 && !mediaFailed && media.every(m=>!!m.url && loaded[m.url]);
  useEffect(()=>{if(!dirty){base.current=bulletin.advisory_revision;setTitle(bulletin.title);setBody(bulletin.body);setAction(bulletin.action);}setConfirmed(false);},[bulletin.advisory_revision,dirty,bulletin.title,bulletin.body,bulletin.action]);
  const advisorySourceIds=bulletin.advisory_source_ids;
  useEffect(()=>{let active=true;setSourcesReady(false);operation("advisory-guidance").then(r=>{if(active){setSources(r.approved.filter((s:{id:string;active:boolean})=>s.active && advisorySourceIds?.includes(s.id)));setSourcesReady(true);}}).catch(()=>{if(active){setSources([]);setError("Guidance could not be loaded. Reopen this step to review it before publishing.");}});return()=>{active=false;};},[advisorySourceIds,operation]);
  const change=()=>{setDirty(true);onDirtyChange(true);setConfirmed(false);setError("");};
  const run=async(fn:()=>Promise<void>)=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);setError("");try{await fn();onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);inFlight.current=false;}};
  return <section className="rg-review-card"><h2>Preview and publish</h2>
    <p><strong>{survey.name}</strong> · {bulletin.diseases?.join(" and ")} · {locationLabel}</p>
    <div className="rg-preview-media">{media.filter(m=>m.url).map(m=>m.type==="video" ? <video key={m.url} src={m.url} controls preload="metadata" aria-label={m.alt} onLoadedData={()=>setLoaded(v=>({...v,[m.url]:true}))} onError={()=>setMediaFailed(true)}/> : <img key={m.url} src={m.url} alt={m.alt} onLoad={()=>setLoaded(v=>({...v,[m.url]:true}))} onError={()=>setMediaFailed(true)}/>)}</div>
    {!published && !mediaReady ? <p role="status">{mediaFailed ? "Preview media could not be loaded. Refresh the review before publishing." : "All approved preview images and clips must load before final confirmation. If unavailable, refresh the review; nothing will be published."}</p> : null}
    <dl className="rg-preview-outcomes">{(bulletin.diseases||[]).map(d=><div key={d}><dt>{d}</dt><dd>{severityLabel(d)}</dd></div>)}</dl>
    <fieldset disabled={published || busy}><label>Advisory title<input maxLength={240} value={title} onChange={e=>{setTitle(e.target.value);change();}}/></label>
      <label>Public advisory<textarea value={body} maxLength={6000} onChange={e=>{setBody(e.target.value);change();}}/></label>
      <label>Recommended actions<textarea value={action} maxLength={6000} onChange={e=>{setAction(e.target.value);change();}}/></label>
      <button type="button" className="rg-button rg-secondary" disabled={stale || !title.trim() || !body.trim() || !action.trim() || (!dirty && !bulletin.context_review_required)} onClick={()=>void run(async()=>{await saveDraft(bulletin.id,body,action,title,base.current);setDirty(false);onDirtyChange(false);})}>Save reviewed wording</button>
      <button type="button" className="rg-button rg-secondary" disabled={dirty || !readiness?.steps.find(s=>s.step==="images")?.complete} onClick={()=>void run(async()=>{await generateAdvisory(bulletin.id,"generate");})}>Generate advisory with AI</button>
      <small>AI generation runs only when you press this button. Review the resulting draft before publishing.</small></fieldset>
    {stale ? <p role="alert">This draft changed in another tab. Your wording is retained; it cannot overwrite the newer revision.</p> : null}
    <h3>Recommended actions preview</h3><ul>{advisoryActionSteps(action).map((text,i)=><li key={i}>{text}</li>)}</ul>
    <h3>Approved guidance</h3>{sources.length ? <ul>{sources.map(s=><li key={s.id}>{s.disease}: <a href={s.source_reference} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul> : <p>No selected approved guidance is available yet. Review the guidance library and explicitly generate the advisory.</p>}
    <Link to={`/admin/advisories?survey=${survey.id}&advisory=${bulletin.id}#guidance-library`}>Open this advisory’s guidance library</Link>
    {!published ? <><h3>Ready to publish?</h3><ul className="rg-readiness-list">{readiness?.steps.map(s=><li key={s.step}><strong>{s.complete ? "Reviewed" : "Needed"}</strong> · {s.reason}</li>)}</ul>
      <label className="rg-check"><input type="checkbox" checked={confirmed} disabled={!readiness?.ready || !mediaReady || !sourcesReady || !sources.length || dirty || busy} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed the images, outcomes, location choice, advisory and cited guidance.</label>
      <button type="button" className="rg-button rg-primary" disabled={!readiness?.ready || !mediaReady || !sourcesReady || !sources.length || !confirmed || dirty || busy || stale} onClick={()=>void run(async()=>{const result=await publish(bulletin.id);setSuccess(result || {public_path:`/advisories/${bulletin.slug}`});setConfirmed(false);})}>{busy ? "Publishing…" : "Publish advisory"}</button>
      <p role="status">{dirty ? "Save your wording before publication." : !readiness?.ready ? "Complete the items marked Needed. Nothing has been published." : !confirmed ? "Check your final review confirmation to publish." : "Ready to publish this advisory only. No SMS will be sent."}</p></> : <p role="status">This advisory is published. Create a correction above to change it.</p>}
    {success ? <div role="status" className="rg-review-success"><h3>Advisory published</h3><Link className="rg-button rg-primary" to={success.public_path || `/advisories/${bulletin.slug}`}>View public post</Link>{success.map_eligible ? <Link className="rg-button rg-secondary" to={`/map?advisory=${bulletin.id}`}>View public map pin</Link> : <p>Published in the bulletin without a public map pin.</p>}<p>No SMS was sent.</p></div> : null}
    {error ? <p role="alert" className="rg-notice rg-notice-error">{error}</p> : null}
    <aside className="rg-sms-separate"><h3>SMS is a separate action</h3><p>Publishing does not send messages. Delivery and consent are managed separately.</p><Link to="/admin/sms">Open SMS delivery</Link></aside>
  </section>;
}
