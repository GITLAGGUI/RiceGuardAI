import {describe,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as helpers from '../../../supabase/functions/_shared/smsDelivery';

// Execute the actual Edge entrypoints with entirely synthetic DB/network APIs.
// No environment file, credentials, Supabase client or network connection is used.
type Row=Record<string,unknown>;
function database(initial:Record<string,Row[]>) {
 const tables=structuredClone(initial),writes:Row[]=[];
 function from(table:string) {
  const filters:((r:Row)=>boolean)[]=[];let update:Row|null=null,insert:Row|null=null,single=false,limit=Infinity;
  const query={select:()=>query,order:()=>query,limit:(n:number)=>{limit=n;return query;},eq:(key:string,value:unknown)=>{filters.push(r=>r[key]===value);return query;},
   in:(key:string,values:unknown[])=>{filters.push(r=>values.includes(r[key]));return query;},
   lte:()=>query,lt:()=>query,update:(value:Row)=>{update=value;return query;},insert:(value:Row)=>{insert=value;return query;},
   single:()=>{single=true;return query;},maybeSingle:()=>{single=true;return query;},
   then(resolve:(result:{data:Row[]|Row|null;error:null})=>unknown){
    if(insert){(tables[table] ||= []).push({...insert,id:'fixture-event'});writes.push({table,...insert});}
    const selected=(tables[table]||[]).filter(r=>filters.every(f=>f(r))).slice(0,limit);
    if(update){selected.forEach(row=>Object.assign(row,update));writes.push({table,...update});}
    return Promise.resolve({data:single?selected[0]||null:structuredClone(selected),error:null}).then(resolve);
   }};return query;
 }
 return {tables,writes,from,rpc:async (name:string,p:Row)=>{
  if(name==='rg_sms_receipt') {
   if((tables.rg_events||[]).some(e=>e.external_id===p.p_event))return{data:{accepted:true,duplicate:true},error:null};
   (tables.rg_events ||= []).push({external_id:p.p_event,kind:p.p_kind,entity_id:p.p_message});
   const r=tables.rg_recipients.find(r=>r.message_id===p.p_message&&r.phone===p.p_phone);
   if(!r)return{data:{accepted:true,matched:false},error:null};
   if(p.p_kind==='sms:failed')Object.assign(r,{status:'failed',delivered_at:null});
   else if(r.status!=='failed') {
    if(p.p_kind==='sms:sent'){if(p.p_parts)r.parts_expected=p.p_parts;if(['unknown','accepted'].includes(String(r.status)))r.status='sent';}
    else r.parts_delivered=Number(r.parts_delivered||0)+1;
    if(helpers.completeDeliveryProof(r.parts_expected,r.parts_delivered))Object.assign(r,{status:'delivered',delivered_at:'fixture-time',error:null});
   }
   return{data:{accepted:true,status:r.status},error:null};
  }
  const r=tables.rg_recipients.find(r=>r.id===p.p_recipient);if(r?.status!=='queued')return{data:false,error:null};
  Object.assign(r,{status:'unknown',attempts:Number(r.attempts||0)+1,message_id:r.client_message_id});return {data:true,error:null};
 }};
}
const queued=()=>({id:'fixture-recipient',campaign_id:'fixture-campaign',contact_id:'fixture-contact',phone:'+639000000000',client_message_id:'fixture-message',attempts:0,status:'queued',rg_campaigns:{revision:3,message_text:'Synthetic test message only',device_id:'fixture-device',sim_number:2,rg_bulletins:{status:'published',advisory_revision:3}}});
async function load(name:'send-sms'|'sms-webhook',db:ReturnType<typeof database>,fetchMock:ReturnType<typeof vi.fn>,extra:Record<string,string>={}) {
 let handler:(r:Request)=>Promise<Response>=async()=>new Response(null,{status:500});
 const source=(await readFile(new URL(`../../../supabase/functions/${name}/index.ts`,import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const env={SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',CRON_SECRET:'fixture-cron',SMS_GATE_USER:'fixture-user',SMS_GATE_PASS:'fixture-pass',SMS_GATE_WEBHOOK_TOKEN:'fixture-token',SMS_DISPATCH_ENABLED:'true',...extra};
 runInNewContext(compiled,{...helpers,isManilaQuietHour:()=>false,createClient:()=>db,Deno:{env:{get:(k:keyof typeof env)=>env[k]},serve:(h:typeof handler)=>{handler=h;}},fetch:fetchMock,Request,Response,URL,AbortSignal,Date,crypto,TextEncoder,Uint8Array,btoa,console});
 return handler;
}
const request=(payload:unknown={})=>new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer fixture-cron'},body:JSON.stringify(payload)});
const contact=()=>({id:'fixture-contact',consent:true,verified:true,phone:'+639000000000'});
describe('actual SMS worker with isolated dependencies',()=>{
 it('rejects dry-run dispatch without any send or database write',async()=>{
  const db=database({rg_recipients:[queued()],rg_contacts:[contact()]});const net=vi.fn();const handler=await load('send-sms',db,net);
  expect((await handler(request({dry_run:true}))).status).toBe(400);expect(net).not.toHaveBeenCalled();expect(db.writes).toHaveLength(0);expect(db.tables.rg_recipients[0].status).toBe('queued');
 });
 it('defaults to disabled before any fetch or DB mutation',async()=>{
  const db=database({rg_recipients:[queued()],rg_contacts:[contact()]});const net=vi.fn();const handler=await load('send-sms',db,net,{SMS_DISPATCH_ENABLED:''});
  expect(await(await handler(request())).json()).toMatchObject({status:'dispatch_disabled',sends:0});expect(net).not.toHaveBeenCalled();expect(db.writes).toHaveLength(0);
 });
 it('preserves timeout outcome and uses GET only without claiming aggregate multipart delivery',async()=>{
  const db=database({rg_recipients:[queued()],rg_contacts:[contact()]});const net=vi.fn().mockRejectedValue(new Error('fixture timeout'));const handler=await load('send-sms',db,net);
  await handler(request());expect(db.tables.rg_recipients[0]).toMatchObject({status:'unknown',attempts:1,message_id:'fixture-message'});
  net.mockResolvedValue(new Response(JSON.stringify({state:'Delivered',id:'fixture-message'})));
  await handler(request());expect(db.tables.rg_recipients[0].status).toBe('unknown');expect(net).toHaveBeenCalledTimes(2);
  expect(net.mock.calls[0][1].method).toBe('POST');expect(net.mock.calls[1][1].method).toBeUndefined();
 });
 it('does not resend an unknown request after a provider 404',async()=>{
  const db=database({rg_recipients:[{...queued(),status:'unknown',message_id:'fixture-message'}],rg_contacts:[contact()]});const net=vi.fn().mockResolvedValue(new Response(null,{status:404}));
  await(await load('send-sms',db,net))(request());expect(net).toHaveBeenCalledTimes(1);expect(net.mock.calls[0][1].method).toBeUndefined();expect(db.tables.rg_recipients[0].status).toBe('unknown');
 });
 it('suppresses withdrawn consent before crossing the gateway boundary',async()=>{
  const db=database({rg_recipients:[queued()],rg_contacts:[{...contact(),consent:false}]});const net=vi.fn();await(await load('send-sms',db,net))(request());
  expect(db.tables.rg_recipients[0].status).toBe('suppressed');expect(net).not.toHaveBeenCalled();
 });
 it('marks gateway acceptance honestly and pins the selected device/SIM',async()=>{
  const db=database({rg_recipients:[queued()],rg_contacts:[contact()]});const net=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:'fixture-message'})));
  await(await load('send-sms',db,net))(request());expect(db.tables.rg_recipients[0].status).toBe('accepted');
  expect(JSON.parse(net.mock.calls[0][1].body)).toMatchObject({id:'fixture-message',deviceId:'fixture-device',simNumber:2,withDeliveryReport:true,textMessage:{text:'Synthetic test message only'}});
 });
});
function webhook(event:string,payload:Row,id='fixture-event-id') {return new Request('https://example.invalid?token=fixture-token',{method:'POST',body:JSON.stringify({id,event,payload})});}
describe('actual SMS webhook with isolated dependencies',()=>{
 it('STOP withdraws consent, audits and suppresses queued alerts only',async()=>{
  const db=database({rg_contacts:[contact()],rg_recipients:[queued()],rg_events:[],rg_consent_events:[]});const net=vi.fn();
  expect((await(await load('sms-webhook',db,net))(webhook('sms:received',{sender:'+639000000000',message:' STOP '}))).status).toBe(200);
  expect(db.tables.rg_contacts[0].consent).toBe(false);expect(db.tables.rg_recipients[0].status).toBe('suppressed');expect(net).not.toHaveBeenCalled();expect(db.tables.rg_consent_events).toHaveLength(1);
 });
 it('accepts a late sent receipt for an unknown submission without declaring delivered',async()=>{
  const db=database({rg_recipients:[{...queued(),status:'unknown',message_id:'fixture-message'}],rg_events:[]});const net=vi.fn();
  await(await load('sms-webhook',db,net))(webhook('sms:sent',{messageId:'fixture-message',recipient:'+639000000000',partsCount:3}));expect(db.tables.rg_recipients[0].status).toBe('sent');expect(db.tables.rg_recipients[0].parts_expected).toBe(3);expect(net).not.toHaveBeenCalled();
 });
 it('keeps a single delivered part unconfirmed when expected part count is missing',async()=>{
  const db=database({rg_recipients:[{...queued(),status:'sent',message_id:'fixture-message'}],rg_events:[]});const net=vi.fn().mockResolvedValue(new Response(JSON.stringify({state:'Sent'})));
  await(await load('sms-webhook',db,net))(webhook('sms:delivered',{messageId:'fixture-message',recipient:'+639000000000'}));expect(db.tables.rg_recipients[0].status).toBe('sent');expect(net).not.toHaveBeenCalled();
 });
 it('records delivered only after all unique parts arrive and sent supplies the count',async()=>{
  const db=database({rg_recipients:[{...queued(),status:'unknown',message_id:'fixture-message'}],rg_events:[]});const net=vi.fn().mockResolvedValue(new Response(JSON.stringify({state:'Delivered'})));
  const handler=await load('sms-webhook',db,net);const payload={messageId:'fixture-message',recipient:'+639000000000'};
  await handler(webhook('sms:sent',{...payload,partsCount:3},'fixture-sent-id'));
  await handler(webhook('sms:delivered',payload,'fixture-part-one'));await handler(webhook('sms:delivered',payload,'fixture-part-one'));
  await handler(webhook('sms:delivered',payload,'fixture-part-two'));expect(db.tables.rg_recipients[0]).toMatchObject({status:'sent',parts_delivered:2});
  await handler(webhook('sms:delivered',payload,'fixture-part-three'));expect(db.tables.rg_recipients[0]).toMatchObject({status:'delivered',error:null,parts_delivered:3});expect(db.tables.rg_recipients[0].delivered_at).toBeTruthy();expect(net).not.toHaveBeenCalled();
 });
 it('rejects unauthenticated callbacks without writes',async()=>{
  const db=database({rg_recipients:[queued()],rg_events:[]});const net=vi.fn();const r=new Request('https://example.invalid',{method:'POST',body:'{}'});
  expect((await(await load('sms-webhook',db,net))(r)).status).toBe(401);expect(db.writes).toHaveLength(0);expect(net).not.toHaveBeenCalled();
 });
});
