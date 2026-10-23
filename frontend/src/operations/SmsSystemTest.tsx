import {useState} from "react";
import {useOperations} from "./store";
type Receipt={id:string;status:string;recipients:{contact_id:string;name:string;message_id:string;status:string}[]};
type Preview={contact_ids:string[];contacts:{id:string;name:string}[];message:string;gateway:string;expires_at:string};
export function SmsSystemTest(){
 const {operation}=useOperations();
 const [preview,setPreview]=useState<Preview|null>(null),[receipt,setReceipt]=useState<Receipt|null>(null);
 const [runId]=useState(()=>crypto.randomUUID());
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const run=async(action:string,payload:unknown={})=>{setBusy(true);setError("");try{const r=await operation(action,payload);if(action==="sms-system-test-preview")setPreview(r);else setReceipt(r);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="rg-panel"><h2>One-time SMS connection test</h2>
  <p>A system test checks the gateway connection without sending a farm advisory or creating a farm pin. Only temporarily authorized, verified and consenting contacts can receive it.</p>
  {!receipt?<button className="rg-button rg-secondary" disabled={busy} onClick={()=>void run("sms-system-test-preview")}>Preview system test — no SMS</button>:null}
  {preview&&!receipt?<><p>Recipients: {preview.contacts.map(c=>c.name).join(" and ")}. One SMS per contact.</p><p>{preview.message}</p><p>Gateway: {preview.gateway}. Test window closes: {new Date(preview.expires_at).toLocaleTimeString()}.</p>
   <label><input type="checkbox" checked={confirmed} disabled={busy||preview.gateway!=="connected"} onChange={e=>setConfirmed(e.target.checked)}/>I authorize this one-time system test to the listed contacts only.</label>
   <button className="rg-button rg-primary" disabled={busy||!confirmed||preview.gateway!=="connected"} onClick={()=>void run("sms-system-test-send",{id:runId,contact_ids:preview.contact_ids,confirmed:true})}>Send one test SMS per contact</button></>:null}
  {receipt?<><p>Test recorded. This test is separate from farmer-advisory campaign counters.</p>{receipt.recipients.map(r=><p key={r.contact_id}><strong>{r.name}</strong>: {r.status}</p>)}
   <button className="rg-button rg-secondary" disabled={busy} onClick={()=>void run("sms-system-test-status",{id:receipt.id})}>Check test receipts — no resend</button></>:null}
  <p>Accepted means the gateway received the request. Failed means delivery did not complete. Only a delivered receipt confirms reception; lack of SIM load can prevent sending.</p>
  {error?<p role="alert">{error}</p>:null}
 </section>;
}
