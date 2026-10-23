import {useState} from 'react';
import {useOperations} from './store';
import type {Campaign} from './domain';
import {SmsSystemTest} from './SmsSystemTest';

type Preview = {id:string;advisory_revision:number;hash:string;count:number;message:string;segments:number;encoding:string;gateway:string;dispatch_enabled:boolean;receipt_ready:boolean;device_selected:boolean;sim_selected:boolean;quiet_hours:boolean;resume_at:string|null;existing_campaign_id:string|null;recipients:{id:string;name:string}[]};
const states=['queued','accepted','sent','delivered','failed','unknown','suppressed'] as const;
export function SmsDelivery() {
 const {data,demo,operation}=useOperations();
 const [id,setId]=useState('');const [contact,setContact]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null);const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [campaigns,setCampaigns]=useState<Campaign[]|null>(null);
 const published=data.bulletins.filter(b=>b.status==='published');
 const eligible=data.contacts.filter(c=>c.consent&&c.verified);
 const rows=campaigns||data.campaigns;
 function clear(){setPreview(null);setConfirmed(false);setNotice('');setError('');}
 async function readPreview() {
  clear();setBusy(true);
  try{setPreview(await operation('sms-preview',{id,contact_id:contact||null}));}
  catch(e){setError(e instanceof Error?e.message:'SMS preview unavailable');}finally{setBusy(false);}
 }
 async function refresh() {
  setBusy(true);setError('');
  try{setCampaigns((await operation('sms-status')).campaigns);}catch(e){setError(e instanceof Error?e.message:'Delivery status unavailable');}finally{setBusy(false);}
 }
 async function enqueue() {
  if(!preview||!confirmed)return;setBusy(true);setError('');
  try{
   const result=await operation('sms-enqueue',{id:preview.id,contact_id:contact||null,advisory_revision:preview.advisory_revision,hash:preview.hash,confirmed:true});
   setNotice(result.duplicate?'This campaign was already queued. No duplicate campaign was created.':`Queued for ${result.recipients} contact${result.recipients===1?'':'s'}. Delivery has not been confirmed.`);
   setPreview(null);setConfirmed(false);setCampaigns((await operation('sms-status')).campaigns);
  }catch(e){setError(e instanceof Error?e.message:'SMS campaign could not be queued');setConfirmed(false);setPreview(null);}finally{setBusy(false);}
 }
 const canQueue=preview&&preview.count>0&&preview.dispatch_enabled&&preview.receipt_ready&&preview.gateway==='connected'&&!preview.existing_campaign_id;
 return <div className="rg-sms-delivery">
  <div className="rg-notice">Preview checks the message and eligible recipients without queueing or sending. An online gateway does not confirm SIM load or carrier delivery.</div>
  {demo?<p role="status">SMS preview and queueing require the live staff workspace. These sample records cannot send SMS.</p>:<section className="rg-panel">
   <h2>Preview a separate SMS campaign</h2>
   <p>Choose a published advisory and, for a defense rehearsal, one consenting test contact with a registered farm within 3 km.</p>
   <label>Published advisory<select aria-label="Published advisory" value={id} onChange={e=>{setId(e.target.value);clear();}}><option value="">Choose an advisory</option>{published.map(b=><option key={b.id} value={b.id}>{b.title}</option>)}</select></label>
   <label>Recipients<select aria-label="Recipients" value={contact} onChange={e=>{setContact(e.target.value);clear();}}><option value="">All eligible contacts within 3 km</option>{eligible.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <button className="rg-button rg-secondary" disabled={busy||!id} onClick={()=>void readPreview()}>Preview only — no SMS</button>
   {preview?<div className="rg-delivery-preview">
    <h3>SMS preview</h3><p>{preview.count} eligible contact{preview.count===1?'':'s'} · {preview.segments} SMS segment{preview.segments===1?'':'s'} per contact · {preview.encoding}</p>
    <div className="rg-sms-bubble"><p>{preview.message}</p></div>
    <p>Gateway: {preview.gateway.replaceAll('_',' ')}. Delivery callbacks: {preview.receipt_ready?'configured; delivery still unproven':'not configured'}.</p>
    <p>{preview.device_selected?'A gateway device is selected.':'The gateway uses its configured device selection.'} {preview.sim_selected?'A SIM slot is selected.':'The gateway uses its configured SIM selection.'}</p>
    {preview.quiet_hours?<p>Quiet hours: queued messages wait until {new Date(preview.resume_at!).toLocaleString('en-PH',{timeZone:'Asia/Manila'})} Manila time.</p>:null}
    {!preview.dispatch_enabled?<p role="status">Sending is disabled. This preview did not send or queue any messages.</p>:null}
    {preview.existing_campaign_id?<p role="status">This advisory revision already has an SMS campaign. Check its delivery status below.</p>:null}
    {preview.count===0?<p role="status">No verified, consenting registered farms match this advisory’s approved location.</p>:null}
    <label><input type="checkbox" checked={confirmed} disabled={!canQueue||busy} onChange={e=>setConfirmed(e.target.checked)}/> I checked this message and recipient count, and the gateway SIM is ready. I authorize this separate SMS campaign.</label>
    <button className="rg-button rg-primary" disabled={busy||!confirmed||!canQueue} onClick={()=>void enqueue()}>Queue SMS to {preview.count} contact{preview.count===1?'':'s'}</button>
   </div>:null}
  </section>}
  {!demo?<SmsSystemTest/>:null}
  {error?<p className="rg-notice" role="alert">{error}</p>:null}{notice?<p className="rg-notice" role="status">{notice}</p>:null}
  <div className="rg-stat-grid">{states.map(state=><article className="rg-stat" key={state}><span>{state}</span><strong>{rows.reduce((n,c)=>n+(c.counts?.[state]||0),0)}</strong><small>Actual recipient count</small></article>)}</div>
  <section className="rg-panel"><div className="rg-panel-heading"><h2>Delivery receipts</h2><button className="rg-button rg-secondary" disabled={busy||demo} onClick={()=>void refresh()}>Refresh status</button></div>
   <p>Accepted means the gateway accepted a request. Delivered requires a complete gateway delivery report. Unknown outcomes are checked by message ID without sending again.</p>
   {rows.length?rows.map(c=><div className="rg-campaign-row" key={c.id}><div><strong>{data.bulletins.find(b=>b.id===c.bulletin_id)?.title||'Published advisory'}</strong><small>{c.created_at}</small>{c.delivered_at?<small>Latest confirmed delivery: {new Date(c.delivered_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'})}</small>:null}</div><span>{c.recipients} contacts</span><span>{c.status}</span><small>{states.filter(s=>c.counts?.[s]).map(s=>`${c.counts?.[s]} ${s}`).join(' · ')}</small></div>):<p>No SMS campaigns yet. Publishing an advisory does not send SMS.</p>}
  </section>
 </div>;
}
