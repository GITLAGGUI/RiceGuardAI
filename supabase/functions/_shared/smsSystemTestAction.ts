import {SYSTEM_TEST_MESSAGE,validateSystemTest} from "./smsSystemTest.ts";
import {deliveryState,gatewaySelection} from "./smsDelivery.ts";
const checked=(r:any)=>{if(r.error)throw new Error(r.error.message);return r.data;};
export async function smsSystemTestAction(db:any,actor:string,action:string,p:any,env:{get:(key:string)=>string|undefined},gatewayStatus:()=>Promise<string>){
 const url=env.get("SMS_GATE_URL")||"https://api.sms-gate.app/3rdparty/v1/messages";
 const token=env.get("SMS_GATE_TOKEN"),user=env.get("SMS_GATE_USER"),pass=env.get("SMS_GATE_PASS");
 const authorization=token?`Bearer ${token}`:user&&pass?`Basic ${btoa(`${user}:${pass}`)}`:"";
 const read=async(id:string)=>checked(await db.from("rg_events").select("id,actor_id,detail").eq("id",id).eq("kind","sms_system_test").single());
 const show=(row:any)=>({id:row.id,...row.detail,message:SYSTEM_TEST_MESSAGE});
 if(action==="sms-system-test-status"){
  const row=await read(String(p.id));if(row.actor_id!==actor)throw new Error("Only the approving administrator can check this test.");
  if(!authorization)throw new Error("SMS gateway credentials unavailable.");
  for(const recipient of row.detail.recipients){
   if(!["accepted","sent","unknown"].includes(recipient.status))continue;
   try{const response=await fetch(`${url.replace(/\/$/,"")}/${encodeURIComponent(recipient.message_id)}`,{headers:{Authorization:authorization},signal:AbortSignal.timeout(5000)});
    if(response.ok){const result=await response.json();recipient.status=deliveryState(result.state)||recipient.status;}
   }catch{/* Keep an unknown outcome; GET-only status checks never resend. */}
  }
  checked(await db.from("rg_events").update({detail:row.detail}).eq("id",row.id));return show(row);
 }
 const allowed=(env.get("SMS_SYSTEM_TEST_CONTACT_IDS")||"").split(",").filter(Boolean);
 const expiry=env.get("SMS_SYSTEM_TEST_EXPIRES_AT");
 const ids=validateSystemTest(action==="sms-system-test-preview"?allowed:p.contact_ids,allowed,expiry);
 const contacts=checked(await db.from("rg_contacts").select("id,name,phone,consent,verified").in("id",ids));
 if(contacts.length!==ids.length||contacts.some((c:any)=>!c.consent||!c.verified||!/^\+639\d{9}$/.test(c.phone)))throw new Error("Every approved test contact must still be verified and consenting.");
 const gateway=await gatewayStatus();
 if(action==="sms-system-test-preview")return {contact_ids:ids,contacts:contacts.map((c:any)=>({id:c.id,name:c.name})),message:SYSTEM_TEST_MESSAGE,gateway,expires_at:expiry};
 if(action!=="sms-system-test-send"||p.confirmed!==true)throw new Error("Explicit one-time test approval is required.");
 if(gateway!=="connected"||!authorization)throw new Error("The gateway must be online for this test.");
 if(!/^[0-9a-f-]{36}$/i.test(String(p.id)))throw new Error("Invalid test identity.");
 const detail={status:"submitted",recipients:contacts.map((c:any)=>({contact_id:c.id,name:c.name,message_id:crypto.randomUUID(),status:"not_submitted"}))};
 const row={id:p.id,actor_id:actor,detail};
 // One atomic claim per short approval window, not one claim per button click.
 const inserted=await db.from("rg_events").insert({id:p.id,kind:"sms_system_test",entity_id:p.id,actor_id:actor,external_id:`sms-system-test:${expiry}`,detail});
 if(inserted.error){
  if(inserted.error.code!=="23505")throw new Error("Could not record approval; no test messages sent.");
  const existing=checked(await db.from("rg_events").select("id,actor_id,detail").eq("external_id",`sms-system-test:${expiry}`).single());
  if(existing.actor_id!==actor)throw new Error("This test window was already used.");
  return show(existing);
 }
 for(const recipient of detail.recipients){
  const contact=checked(await db.from("rg_contacts").select("id,phone,consent,verified").eq("id",recipient.contact_id).single());
  if(!contact.consent||!contact.verified||contact.phone!==contacts.find((c:any)=>c.id===recipient.contact_id).phone||Date.parse(expiry!)<=Date.now()){
   recipient.status="suppressed";checked(await db.from("rg_events").update({detail}).eq("id",row.id));continue;
  }
  recipient.status="unknown";
  checked(await db.from("rg_events").update({detail}).eq("id",row.id));
  try{const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",Authorization:authorization},signal:AbortSignal.timeout(25000),
   body:JSON.stringify({id:recipient.message_id,textMessage:{text:SYSTEM_TEST_MESSAGE},phoneNumbers:[contact.phone],ttl:180,withDeliveryReport:true,...gatewaySelection(env.get("SMS_GATE_DEVICE_ID"),env.get("SMS_GATE_SIM_NUMBER"))})});
   const result=await response.json().catch(()=>({}));
   if(response.ok){recipient.message_id=result.id||recipient.message_id;recipient.status="accepted";}
   else if(response.status!==409&&response.status<500)recipient.status="failed";
  }catch{/* Keep unknown and the same ID; never retry a send automatically. */}
  checked(await db.from("rg_events").update({detail}).eq("id",row.id));
 }
 return show(row);
}
