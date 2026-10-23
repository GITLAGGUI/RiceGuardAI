import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { canReceiveSms, deliveryState, gatewaySelection, isManilaQuietHour, nextManilaSixAm } from "../_shared/smsDelivery.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const gatewayUrl = Deno.env.get("SMS_GATE_URL") || "https://api.sms-gate.app/3rdparty/v1/messages";
const gatewayToken = Deno.env.get("SMS_GATE_TOKEN");
const gatewayUser = Deno.env.get("SMS_GATE_USER");
const gatewayPass = Deno.env.get("SMS_GATE_PASS");
const checked = <T>(result: {data:T;error:{message:string}|null}) => { if(result.error)throw new Error(result.error.message);return result.data; };

Deno.serve(async (req) => {
 const cronSecret = Deno.env.get("CRON_SECRET");
 if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) return json({ error: "Unauthorized" }, 401);
 if (req.method !== "POST") return json({error:"Method not allowed"},405);
 // Deployment defaults to preview-only. Even a mistaken dry-run body cannot send.
 const body = await req.json().catch(()=>({}));
 if (body.dry_run === true) return json({error:"Use the staff SMS preview action; dispatch is not a dry-run endpoint",sends:0},400);
 if (Deno.env.get("SMS_DISPATCH_ENABLED") !== "true") return json({status:"dispatch_disabled",sends:0});
 if ((!gatewayToken && !(gatewayUser && gatewayPass)) || !gatewayUrl) return json({ error: "SMS Gate is not configured; queued messages were preserved" }, 503);
 const authorization = gatewayToken ? `Bearer ${gatewayToken}` : `Basic ${btoa(`${gatewayUser}:${gatewayPass}`)}`;
 const report = {accepted:0,suppressed:0,failed:0,unknown:0,reconciled:0};
 try {
  // GET-only reconciliation never resubmits ambiguous requests, including 409.
  const uncertain = checked(await db.from("rg_recipients").select("id,message_id,client_message_id").in("status",["unknown","accepted","sent"]).order("last_reconciled_at",{nullsFirst:true}).limit(5));
  for(const row of uncertain || []) {
   const id = row.message_id || row.client_message_id;if(!id)continue;
   checked(await db.from("rg_recipients").update({last_reconciled_at:new Date().toISOString()}).eq("id",row.id));
   try {
    const response = await fetch(`${gatewayUrl.replace(/\/$/,"")}/${encodeURIComponent(id)}`, {headers:{Authorization:authorization},signal:AbortSignal.timeout(5_000)});
    if(!response.ok)continue; // 404 is not permission to resend an unknown outcome.
    const provider = await response.json(); const state = deliveryState(provider.state);
    if(!state)continue;
    const update = {status:state,message_id:provider.id || id,error:state==='failed'?'Gateway reports delivery failed':null};
    checked(await db.from("rg_recipients").update(update).eq("id",row.id).in("status",["unknown","accepted","sent"]));report.reconciled++;
   } catch { /* Keep ambiguous state for a future status read. */ }
  }
  if(isManilaQuietHour()) {
   const resume=nextManilaSixAm();checked(await db.from("rg_recipients").update({not_before:resume}).eq("status","queued").lt("not_before",resume));
   return json({...report,status:"quiet_hours",resume_at:resume});
  }
  const recipients=checked(await db.from("rg_recipients").select("id,campaign_id,contact_id,phone,client_message_id,rg_campaigns!inner(id,bulletin_id,revision,message_text,device_id,sim_number,rg_bulletins!inner(status,advisory_revision,archived_at))").eq("status","queued").lte("not_before",new Date().toISOString()).order("created_at").limit(1));
  for(const recipient of recipients || []) {
   const campaign=recipient.rg_campaigns;const bulletin=campaign.rg_bulletins;
   const contact=checked(await db.from("rg_contacts").select("consent,verified,phone").eq("id",recipient.contact_id).single());
   if(!canReceiveSms(contact,bulletin)||contact.phone!==recipient.phone||campaign.revision!==bulletin.advisory_revision||!campaign.message_text||!recipient.client_message_id) {
    checked(await db.from("rg_recipients").update({status:"suppressed",error:"Consent, verification or approved campaign revision is no longer active"}).eq("id",recipient.id).eq("status","queued"));report.suppressed++;continue;
   }
   const selection=gatewaySelection(campaign.device_id || Deno.env.get("SMS_GATE_DEVICE_ID"),campaign.sim_number?String(campaign.sim_number):Deno.env.get("SMS_GATE_SIM_NUMBER"));
   const claimed=checked(await db.rpc("rg_sms_claim",{p_recipient:recipient.id}));if(!claimed)continue;
   try {
    const response=await fetch(gatewayUrl,{method:"POST",headers:{"Content-Type":"application/json",Authorization:authorization},signal:AbortSignal.timeout(25_000),body:JSON.stringify({id:recipient.client_message_id,textMessage:{text:campaign.message_text},phoneNumbers:[recipient.phone],ttl:3600,withDeliveryReport:true,...selection})});
    const provider=await response.json().catch(()=>({}));
    if(response.ok) {
     checked(await db.from("rg_recipients").update({status:"accepted",message_id:provider.id||recipient.client_message_id,accepted_at:new Date().toISOString(),error:null}).eq("id",recipient.id).eq("status","unknown"));report.accepted++;
    } else if(response.status===409 || response.status>=500) {
     checked(await db.from("rg_recipients").update({error:`Gateway outcome requires status reconciliation (${response.status})`}).eq("id",recipient.id).eq("status","unknown"));report.unknown++;
    } else {
     checked(await db.from("rg_recipients").update({status:"failed",error:`Gateway rejected request (${response.status})`}).eq("id",recipient.id).eq("status","unknown"));report.failed++;
    }
   } catch {
    // Atomic claim preserved unknown, attempts and ID. Do not downgrade a receipt.
    checked(await db.from("rg_recipients").update({error:"Send outcome uncertain; awaiting provider status"}).eq("id",recipient.id).eq("status","unknown"));report.unknown++;
   }
  }
  return json(report);
 } catch { return json({error:"SMS processing could not complete; inspect delivery state before retrying"},500); }
});
