import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import vm from 'node:vm';
const source=await readFile(new URL('../Code.gs',import.meta.url),'utf8');
const manifest=JSON.parse(await readFile(new URL('../appsscript.json',import.meta.url),'utf8'));
const secret='d'.repeat(64),recipient='jlaggui47@gmail.com'; // Synthetic test key only.
const domain='riceguard.apps-script.notice-relay.v1',version='riceguard.advisory.notice.v1',purpose='advisory_ready';
const start=1800000000;
function envelope(event_id=randomUUID(),issued_at=start){
  const value={version,purpose,event_id,issued_at};
  value.signature=createHmac('sha256',secret).update(`${domain}\n${version}\n${purpose}\n${issued_at}\n${event_id}`,'utf8').digest('hex');
  return value;
}
function request(value){const contents=typeof value==='string'?value:JSON.stringify(value);return {contentLength:Buffer.byteLength(contents),postData:{contents,type:'application/json',length:Buffer.byteLength(contents)}};}
function harness(shared={}){
  shared.properties??={RELAY_HMAC_SECRET:secret,RELAY_RECIPIENT:recipient};
  shared.mail??=[];shared.locked??=false;shared.now??=start;shared.quota??=10;
  const properties={getProperty:k=>shared.properties[k]??null,setProperty:(k,v)=>{shared.writes=(shared.writes??0)+1;if(shared.failStore||shared.writes>(shared.failStoreAfter??Infinity))throw Error('private persistence error');shared.properties[k]=v;return properties;}};
  const context=vm.createContext({
    Date:class extends Date{static now(){return shared.now*1000;}},
    PropertiesService:{getScriptProperties:()=>properties},
    LockService:{getScriptLock:()=>({tryLock:()=>{if(shared.locked)return false;shared.locked=true;return true;},releaseLock:()=>{shared.locked=false;}})},
    Utilities:{Charset:{UTF_8:'UTF-8'},computeHmacSha256Signature:(value,key)=>Array.from(createHmac('sha256',key).update(value,'utf8').digest(),b=>b>127?b-256:b)},
    MailApp:{getRemainingDailyQuota:()=>shared.quota,sendEmail:(to,subject,body)=>{if(shared.duringSend)shared.duringSend();if(shared.failSend)throw Error('private provider error');shared.mail.push({to,subject,body});}},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
    console:{log(){throw Error('Logging prohibited in relay tests');}},
    Logger:{log(){throw Error('Logging prohibited in relay tests');}},
  });
  vm.runInContext(source,context,{filename:'Code.gs'});
  return {shared,post:r=>JSON.parse(context.doPost(r).text)};
}
let checks=0;
const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
const denied=(h,value)=>{const before=h.shared.mail.length;const result=h.post(request(value));equal(result.ok,false);equal(h.shared.mail.length,before);return result;};
equal(manifest.oauthScopes,['https://www.googleapis.com/auth/script.send_mail']);
const h=harness(),event=envelope(),receipt=`apps-script:${event.event_id}`;
equal(h.post(request(event)),{ok:true,event_id:event.event_id,status:'sent',provider_receipt:receipt});
equal(h.shared.mail.length,1);
equal(h.shared.mail[0],{to:recipient,subject:'RiceGuardAI advisory event ready',body:`RiceGuardAI advisory review is ready.\n\nEvent ID: ${event.event_id}\n\nUse the authorized RiceGuardAI connector to resolve this event.`});
equal(h.post(request(event)),{ok:true,event_id:event.event_id,status:'duplicate',provider_receipt:receipt});equal(h.shared.mail.length,1);
// Durable receipts survive a new execution/context and even a freshly signed retry.
const restarted=harness(h.shared);equal(restarted.post(request(envelope(event.event_id,start+1))).status,'duplicate');equal(h.shared.mail.length,1);
for(const change of [
  e=>e.recipient='attacker@example.invalid',e=>e.to=recipient,e=>e.body='injected',e=>e.subject='injected',e=>e.gps={lat:1,lng:1},
  e=>e.survey_id=randomUUID(),e=>e.job_id=randomUUID(),e=>e.media=['private/photo.jpg'],e=>e.version='other',e=>e.purpose='other',
  e=>e.event_id='not-a-uuid',e=>e.event_id=e.event_id.toUpperCase(),e=>e.issued_at='1800000000',e=>e.issued_at=1.5,
  e=>e.signature='a'.repeat(64),e=>e.signature='A'.repeat(64),e=>e.signature=null,e=>delete e.signature,
]){const value=envelope();change(value);denied(h,value);}
for(const value of [null,[],true,1,'{','[]',' '.repeat(2049),JSON.stringify(event,null,2),JSON.stringify(event).replace('"purpose":','"purpose":"advisory_ready","purpose":')])denied(h,value);
denied(h,envelope(randomUUID(),start-301));denied(h,envelope(randomUUID(),start+301));
equal(h.post(request(envelope(randomUUID(),start-300))).ok,true);equal(h.post(request(envelope(randomUUID(),start+300))).ok,true);
for(const mutate of [r=>r.contentLength=3000,r=>r.contentLength=-1,r=>r.postData.length=3000,r=>r.postData.type='text/plain',r=>r.queryString='to=attacker',r=>r.pathInfo='other']){
  const req=request(envelope());mutate(req);const before=h.shared.mail.length;equal(h.post(req).ok,false);equal(h.shared.mail.length,before);
}
const badConfig=harness();badConfig.shared.properties.RELAY_RECIPIENT='attacker@example.invalid';denied(badConfig,envelope());
const noKey=harness();delete noKey.shared.properties.RELAY_HMAC_SECRET;denied(noKey,envelope());
const quota=harness();quota.shared.quota=0;equal(denied(quota,envelope()).error,'quota_unavailable');equal(quota.shared.properties.RELAY_SENT_EVENTS,undefined);
const sendFailure=harness(),retry=envelope();sendFailure.shared.failSend=true;equal(denied(sendFailure,retry).error,'manual_reconciliation');equal(JSON.parse(sendFailure.shared.properties.RELAY_SENT_EVENTS)[retry.event_id],[start,'u']);equal(sendFailure.shared.locked,false);
sendFailure.shared.failSend=false;equal(denied(sendFailure,retry).error,'manual_reconciliation');
equal(denied(harness(sendFailure.shared),retry).error,'manual_reconciliation');
const contention=harness(),concurrent=envelope();let nested;
contention.shared.duringSend=()=>{nested=contention.post(request(concurrent));};
equal(contention.post(request(concurrent)).status,'sent');equal(nested,{ok:false,error:'busy'});equal(contention.shared.mail.length,1);equal(contention.shared.locked,false);
// Bounded retention: remove only expired receipts, never evict a live receipt.
const full=harness();const table={};for(let i=0;i<128;i++)table[randomUUID()]=[start,'a'];
assert.ok(JSON.stringify(table).length<8192);checks++;
full.shared.properties.RELAY_SENT_EVENTS=JSON.stringify(table);equal(denied(full,envelope()).error,'receipt_capacity');
const retained=Object.keys(table)[0];equal(full.post(request(envelope(retained))).status,'duplicate');
full.shared.now=start+30*86400+1;equal(full.post(request(envelope(randomUUID(),full.shared.now))).status,'sent');equal(Object.keys(JSON.parse(full.shared.properties.RELAY_SENT_EVENTS)).length,1);
const corrupt=harness();corrupt.shared.properties.RELAY_SENT_EVENTS='{"bad":"data"}';equal(denied(corrupt,envelope()).error,'receipt_store_unavailable');
// Persisting intent fails before sending: safely retryable, zero mail calls.
const noIntent=harness(),noIntentEvent=envelope();noIntent.shared.failStore=true;equal(denied(noIntent,noIntentEvent).error,'receipt_store_unavailable');equal(noIntent.shared.locked,false);
noIntent.shared.failStore=false;equal(noIntent.post(request(noIntentEvent)).status,'sent');
// Mail accepted but accepted-state write failed: durable pending blocks resend.
const uncertain=harness(),uncertainEvent=envelope();uncertain.shared.failStoreAfter=1;
equal(uncertain.post(request(uncertainEvent)).error,'manual_reconciliation');equal(uncertain.shared.mail.length,1);equal(uncertain.shared.locked,false);
equal(JSON.parse(uncertain.shared.properties.RELAY_SENT_EVENTS)[uncertainEvent.event_id],[start,'p']);
uncertain.shared.failStoreAfter=Infinity;equal(uncertain.post(request(uncertainEvent)).error,'manual_reconciliation');equal(uncertain.shared.mail.length,1);
uncertain.shared.now=start+31*86400;equal(uncertain.post(request(envelope(uncertainEvent.event_id,uncertain.shared.now))).error,'manual_reconciliation');equal(uncertain.shared.mail.length,1);
console.log(`PASS: ${checks} mocked Apps Script relay checks; no external project, deployment, or email.`);
