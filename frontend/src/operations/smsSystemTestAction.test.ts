import {afterEach,describe,expect,it,vi} from "vitest";
import {smsSystemTestAction} from "../../../supabase/functions/_shared/smsSystemTestAction";
import {SYSTEM_TEST_MESSAGE} from "../../../supabase/functions/_shared/smsSystemTest";
function fixture(){
 const events:any[]=[],contacts=[{id:"joel",name:"Joel",phone:"+639111111111",consent:true,verified:true},{id:"jaquilyn",name:"Jaquilyn",phone:"+639222222222",consent:true,verified:true}];
 class Query{
  filters:any[]=[];kind="read";value:any;one=false;
  constructor(public table:string){}
  select(){return this;} eq(key:string,value:unknown){this.filters.push((r:any)=>r[key]===value);return this;}
  in(key:string,values:unknown[]){this.filters.push((r:any)=>values.includes(r[key]));return this;}
  insert(value:any){this.kind="insert";this.value=value;return this;} update(value:any){this.kind="update";this.value=value;return this;}
  single(){this.one=true;return this;}
  execute(){const rows=this.table==="rg_contacts"?contacts:events;
   if(this.kind==="insert"){
    if(events.some(r=>r.id===this.value.id||r.external_id===this.value.external_id))return {data:null,error:{code:"23505",message:"duplicate"}};
    events.push(structuredClone(this.value));return {data:null,error:null};
   }
   const selected=rows.filter(r=>this.filters.every(f=>f(r)));
   if(this.kind==="update"){for(const r of selected)Object.assign(r,structuredClone(this.value));return {data:null,error:null};}
   return {data:structuredClone(this.one?selected[0]:selected),error:null};
  }
  then(resolve:any,reject:any){return Promise.resolve(this.execute()).then(resolve,reject);}
 }
 const db={from:(table:string)=>new Query(table)};
 const vars:any={SMS_SYSTEM_TEST_CONTACT_IDS:"joel,jaquilyn",SMS_SYSTEM_TEST_EXPIRES_AT:new Date(Date.now()+600000).toISOString(),SMS_GATE_USER:"test-user",SMS_GATE_PASS:"test-password"};
 const env={get:(key:string)=>vars[key]};
 const call=(action:string,p:any={})=>smsSystemTestAction(db,"staff",action,p,env,async()=>"connected");
 return {call,events,contacts,vars};
}
afterEach(()=>vi.unstubAllGlobals());
describe("one-time SMS test sending and reconciliation",()=>{
 const payload={id:"11111111-0000-4000-8000-000000000001",contact_ids:["joel","jaquilyn"],confirmed:true};
 it("preview never submits a gateway message or records a send",async()=>{
  const f=fixture(),fetch=vi.fn();vi.stubGlobal("fetch",fetch);const r:any=await f.call("sms-system-test-preview");
  expect(r.contacts).toHaveLength(2);expect(r.message).toBe(SYSTEM_TEST_MESSAGE);expect(fetch).not.toHaveBeenCalled();expect(f.events).toHaveLength(0);
 });
 it("sends exactly once per contact and records acceptance, not delivery",async()=>{
  const f=fixture(),fetch=vi.fn(async()=>new Response(JSON.stringify({state:"Pending"}),{status:201}));vi.stubGlobal("fetch",fetch);
  const r:any=await f.call("sms-system-test-send",payload);expect(fetch).toHaveBeenCalledTimes(2);
  for(const [,options]of fetch.mock.calls as any){const body=JSON.parse(options.body);expect(body.textMessage.text).toBe(SYSTEM_TEST_MESSAGE);expect(body.phoneNumbers).toHaveLength(1);expect(body.ttl).toBe(180);}
  expect(r.recipients.map((c:any)=>c.status)).toEqual(["accepted","accepted"]);
 });
 it("retries and new button identities cannot send twice in an approval window",async()=>{
  const f=fixture(),fetch=vi.fn(async()=>new Response("{}",{status:201}));vi.stubGlobal("fetch",fetch);
  await f.call("sms-system-test-send",payload);await f.call("sms-system-test-send",payload);
  await f.call("sms-system-test-send",{...payload,id:"22222222-0000-4000-8000-000000000002"});expect(fetch).toHaveBeenCalledTimes(2);
 });
 it("missing confirmation and expired authorization fail before submission",async()=>{
  const f=fixture(),fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(f.call("sms-system-test-send",{...payload,confirmed:false})).rejects.toThrow();
  f.vars.SMS_SYSTEM_TEST_EXPIRES_AT=new Date(0).toISOString();await expect(f.call("sms-system-test-send",payload)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
 });
 it("keeps a timeout unknown without resubmitting",async()=>{
  const f=fixture(),fetch=vi.fn(async()=>{throw Error("timeout");});vi.stubGlobal("fetch",fetch);
  const r:any=await f.call("sms-system-test-send",payload);expect(r.recipients.every((c:any)=>c.status==="unknown")).toBe(true);
  await f.call("sms-system-test-send",payload);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it("status reads failed and delivered receipts using GET only",async()=>{
  const f=fixture();vi.stubGlobal("fetch",vi.fn(async()=>new Response("{}",{status:201})));await f.call("sms-system-test-send",payload);
  const fetch=vi.fn(async()=>new Response(JSON.stringify({state:"Failed"}),{status:200}));vi.stubGlobal("fetch",fetch);
  const r:any=await f.call("sms-system-test-status",{id:payload.id});expect(r.recipients.every((c:any)=>c.status==="failed")).toBe(true);
  for(const [,options]of fetch.mock.calls as any)expect(options.method).toBeUndefined();
 });
});
