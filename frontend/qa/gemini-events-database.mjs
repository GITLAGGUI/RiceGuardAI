// Synthetic PostgreSQL only. No email transport, recipients, or live data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGeminiDatabase, ids, hash } from './gemini-connector-database.mjs';
const db=await createGeminiDatabase(), {pg}=db;
await pg.exec('alter table rg_processing_jobs add column run_id text');
for(const filename of ['20261023010946_gemini_visual_media.sql','20261023012434_gemini_advisory_ready_events.sql'])
  await pg.exec(await readFile(new URL(`../../supabase/migrations/${filename}`,import.meta.url),'utf8'));
const rpc=(fn,op,input)=>pg.transaction(async tx=>{
  await tx.exec('set local role service_role');
  return (await tx.query(`select public.${fn}($1,$2::jsonb) result`,[op,JSON.stringify(input)])).rows[0].result;
});
const execute=(op,input)=>rpc('rg_mcp_event_store',op,input);
const key={survey_id:ids.survey,job_id:ids.job,result_revision:1,policy_version:'visual-v1'};
let checks=0;
const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
const awaiting=()=>execute('enqueue_ready',key).then(result=>equal(result,{event_id:null,status:'awaiting_authorization',duplicate:false}));
async function rejects(op,input,pattern=/event|catalogue|visual|grant|image|evidence|lease|receipt|failure|permission|owner/i){
  await assert.rejects(execute(op,input),pattern);checks++;
}
async function fixture({catalogue=true,grant=true,allow_images=true}={}){
  await db.reset();
  const original='private/synthetic/original.webp',combined='private/synthetic/combined.webp';
  const manifest={schema_version:'riceguard.result.v2',assets:[{kind:'image',source_asset_id:ids.source,review_paths:{original,combined},diseases:[]}],artifacts:{[original]:{sha256:hash('a')},[combined]:{sha256:hash('b')}}};
  await pg.query("update rg_processing_jobs set run_id='rg-synthetic1234',manifest=$1,result_manifest=$1 where id=$2",[JSON.stringify(manifest),ids.job]);
  await pg.query('update rg_result_revisions set manifest=$1 where job_id=$2',[JSON.stringify(manifest),ids.job]);
  const entries=['original','combined'].map((variant,i)=>({source_asset_id:ids.source,image_index:1,variant,source_sha256:hash(i?'b':'a'),path:`website-inference/v2/jobs/rg-synthetic1234/outputs/advisory-media/visual-v1/${ids.source}/${variant}.jpg`,sha256:hash('d'),bytes:100,width:10,height:10,quality:75}));
  if(catalogue) await rpc('rg_mcp_visual_store','save_catalogue',{catalogue:{schema_version:'riceguard.advisory.catalogue.v1',...key,entries}});
  const connection=grant?await db.connect({allow_images}):null;
  return {connection,manifest};
}
try{
  await fixture({catalogue:false});
  await rejects('enqueue_ready',key);
  equal((await pg.query('select count(*) n from rg_mcp.ready_events')).rows[0].n,0);
  await fixture({catalogue:false,grant:false});await rejects('enqueue_ready',key);
  await fixture({grant:false}); await awaiting();
  equal((await pg.query('select count(*) n from rg_mcp.ready_events')).rows[0].n,0);
  await fixture({allow_images:false}); await awaiting();
  const {connection,manifest}=await fixture();
  const before=await db.protectedRows();
  const created=await execute('enqueue_ready',key);
  assert.match(created.event_id,/^[0-9a-f-]{36}$/);checks++;
  equal(created.status,'pending');equal(created.duplicate,false);
  equal(await execute('enqueue_ready',key),{...created,duplicate:true});
  equal((await pg.query('select count(*) n from rg_mcp.ready_events')).rows[0].n,1);
  const resolve={grant_id:connection.grant_id,event_id:created.event_id};
  // A distinct active owner's real consent grants access only to the other survey.
  const foreignClient='foreign-event-fixture',foreignRequest=crypto.randomUUID();
  const redirect_uri='https://gemini.google.com/fixture/callback',resource='https://riceguardai.dev/api/advisory-mcp';
  await db.execute('register_client',{owner_id:ids.otherOwner,client_id:foreignClient,client_name:'Foreign fixture',redirect_uri,secret_hash:hash('7')});
  await db.execute('create_request',{request_id:foreignRequest,client_id:foreignClient,redirect_uri,resource,scopes:['evidence:read','advisory:submit'],state:'synthetic',challenge:hash('8'),expires_at:db.future(300)});
  await db.execute('preview_consent',{request_id:foreignRequest,owner_id:ids.otherOwner});
  const foreign=await db.execute('complete_consent',{request_id:foreignRequest,owner_id:ids.otherOwner,decision:'allow',survey_ids:[ids.otherSurvey],allow_images:true,code_hash:hash('9'),code_expires_at:db.future(300),grant_expires_at:db.future(3600)});
  await rejects('resolve_event',{...resolve,grant_id:foreign.grant_id});
  const resolved=await execute('resolve_event',resolve);
  equal(Object.keys(resolved).sort(),['event_id','survey_id','job_id','result_revision','policy_version','catalogue_sha256','status'].sort());
  equal({...resolved,catalogue_sha256:undefined},{...key,event_id:created.event_id,status:'pending',catalogue_sha256:undefined});
  assert.match(resolved.catalogue_sha256,/^[a-f0-9]{64}$/);checks++;
  assert.ok(!JSON.stringify(resolved).includes('private/'));checks++;
  for(const bad of [{...key,policy_version:'visual-v2'},{...key,result_revision:'1'},{...key,job_id:ids.otherJob},{...key,result_revision:2},{...key,extra:'rejected'}]) await rejects('enqueue_ready',bad);
  const lease1=crypto.randomUUID(),lease2=crypto.randomUUID();
  const notice={event_id:created.event_id,lease_id:lease1};
  await rejects('ack_notice',{...notice,provider_receipt:'synthetic-receipt'});
  const claimed=await execute('claim_notice',notice);
  equal(claimed.status,'leased');equal(claimed.lease_id,lease1);
  assert.ok(Date.parse(claimed.lease_expires_at)>Date.now() && Date.parse(claimed.lease_expires_at)<=Date.now()+301000);checks++;
  equal(await execute('claim_notice',notice),claimed);
  await rejects('claim_notice',{...notice,lease_id:lease2});
  await rejects('ack_notice',{...notice,lease_id:lease2,provider_receipt:'synthetic-receipt'});
  await rejects('ack_notice',{...notice,provider_receipt:''});
  await rejects('ack_notice',{...notice,provider_receipt:'x'.repeat(257)});
  await rejects('ack_notice',{...notice,provider_receipt:'contains\nlog'});
  await rejects('record_failed',{...notice,failure_code:'smtp credentials and arbitrary logs'});
  // Move only synthetic time state; no wall-clock sleep or live lease manipulation.
  await pg.query("update rg_mcp.ready_events set lease_expires_at=now()-interval '1 second' where id=$1",[created.event_id]);
  await rejects('claim_notice',notice);
  await rejects('ack_notice',{...notice,provider_receipt:'synthetic-receipt'});
  const second=await execute('claim_notice',{...notice,lease_id:lease2});equal(second.lease_id,lease2);
  await rejects('ack_notice',{...notice,provider_receipt:'synthetic-receipt'});
  equal(await execute('record_failed',{...notice,lease_id:lease2,failure_code:'transport_timeout'}),{event_id:created.event_id,status:'failed'});
  equal(await execute('record_failed',{...notice,lease_id:lease2,failure_code:'transport_timeout'}),{event_id:created.event_id,status:'failed'});
  await rejects('claim_notice',{...notice,lease_id:lease2});
  const lease3=crypto.randomUUID();
  const third=await execute('claim_notice',{...notice,lease_id:lease3});equal(third.status,'leased');
  const ack={...notice,lease_id:lease3,provider_receipt:'synthetic-provider-receipt-001'};
  equal(await execute('ack_notice',ack),{event_id:created.event_id,status:'notified'});
  equal(await execute('ack_notice',ack),{event_id:created.event_id,status:'notified'});
  await rejects('ack_notice',{...ack,provider_receipt:'different-receipt'});
  equal((await execute('claim_notice',{...notice,lease_id:crypto.randomUUID()})).status,'notified');
  equal((await execute('enqueue_ready',key)).event_id,created.event_id);
  equal((await execute('resolve_event',resolve)).status,'notified');
  await pg.query('update rg_mcp.grants set allow_images=false where id=$1',[connection.grant_id]);
  await rejects('resolve_event',resolve);await awaiting();
  await rejects('claim_notice',{...notice,lease_id:crypto.randomUUID()});
  await pg.query('update rg_mcp.grants set allow_images=true,revoked_at=now() where id=$1',[connection.grant_id]);
  await rejects('resolve_event',resolve);await awaiting();
  await pg.query('update rg_mcp.grants set revoked_at=null,created_at=now()-interval \'2 days\',expires_at=now()-interval \'1 second\' where id=$1',[connection.grant_id]);
  await rejects('resolve_event',resolve);await awaiting();
  await pg.query("update rg_mcp.grants set expires_at=now()+interval '1 day',scopes=array['evidence:read'] where id=$1",[connection.grant_id]);
  await awaiting();
  await pg.query("update rg_mcp.grants set scopes=array['evidence:read','advisory:submit'] where id=$1",[connection.grant_id]);
  await pg.query('update rg_mcp.survey_access set revoked_at=now() where grant_id=$1',[connection.grant_id]);
  await rejects('resolve_event',resolve);await awaiting();
  await pg.query('update rg_mcp.survey_access set revoked_at=null where grant_id=$1',[connection.grant_id]);
  await pg.query('update profiles set is_active=false where id=$1',[ids.owner]);
  await rejects('resolve_event',resolve);await awaiting();
  await pg.query('update profiles set is_active=true where id=$1',[ids.owner]);
  await pg.query('update rg_surveys set active_result_revision=2 where id=$1',[ids.survey]);
  await rejects('resolve_event',resolve);await rejects('enqueue_ready',key);
  await rejects('claim_notice',{...notice,lease_id:crypto.randomUUID()});
  await pg.query('update rg_surveys set active_result_revision=1,archived_at=now() where id=$1',[ids.survey]);
  await rejects('resolve_event',resolve);await rejects('enqueue_ready',key);
  await pg.query('update rg_surveys set archived_at=null where id=$1',[ids.survey]);
  await pg.query("update rg_processing_jobs set result_manifest=jsonb_set(result_manifest,'{artifacts}','{}') where id=$1",[ids.job]);
  await pg.query('update rg_result_revisions set manifest=(select result_manifest from rg_processing_jobs where id=$1) where job_id=$1',[ids.job]);
  await rejects('resolve_event',resolve);await rejects('enqueue_ready',key);
  // Restore source solely to verify that outbox operations themselves never edit it.
  await pg.query('update rg_processing_jobs set result_manifest=$1 where id=$2',[JSON.stringify(manifest),ids.job]);
  await pg.query('update rg_result_revisions set manifest=$1 where job_id=$2',[JSON.stringify(manifest),ids.job]);
  equal(await db.protectedRows(),before);
  equal((await pg.query('select manifest,result_manifest from rg_processing_jobs where id=$1',[ids.job])).rows[0],{manifest,result_manifest:manifest});
  for(const role of ['anon','authenticated']){
    equal((await pg.query("select has_function_privilege($1,'public.rg_mcp_event_store(text,jsonb)','execute') rpc,has_table_privilege($1,'rg_mcp.ready_events','select,insert,update,delete') tbl",[role])).rows[0],{rpc:false,tbl:false});
    await assert.rejects(pg.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query("select public.rg_mcp_event_store('resolve_event',$1)",[JSON.stringify(resolve)]);}),/permission denied/);checks++;
  }
  equal((await pg.query("select relrowsecurity from pg_class where oid='rg_mcp.ready_events'::regclass")).rows[0].relrowsecurity,true);
  equal((await pg.query("select count(*) n from pg_policies where schemaname='rg_mcp' and tablename='ready_events'")).rows[0].n,0);
  const columns=(await pg.query("select column_name from information_schema.columns where table_schema='rg_mcp' and table_name='ready_events'")).rows.map(r=>r.column_name);
  assert.ok(!columns.some(c=>/recipient|email|credential|photo|image|path/i.test(c)));checks++;
  await assert.rejects(pg.exec('update rg_mcp.ready_events set catalogue_sha256=repeat(\'e\',64)'),/immutable/i);checks++;
  await assert.rejects(pg.transaction(async tx=>{await tx.exec('set local role service_role');await tx.exec('delete from rg_mcp.ready_events');}),/permission denied/);checks++;
  await rejects('resolve_event',{...resolve,event_id:crypto.randomUUID()});
  await rejects('unsupported',{});
  await fixture();
  const retry=await execute('enqueue_ready',key);
  for(let i=0;i<5;i++){
    const lease_id=crypto.randomUUID();
    equal((await execute('claim_notice',{event_id:retry.event_id,lease_id})).status,'leased');
    equal((await execute('record_failed',{event_id:retry.event_id,lease_id,failure_code:'transport_unavailable'})).status,'failed');
  }
  await rejects('claim_notice',{event_id:retry.event_id,lease_id:crypto.randomUUID()},/attempt limit/i);
  console.log(`PASS: ${checks} synthetic ready-event checks (source/grant bindings, idempotent identity, notice leases/ack, ACL/RLS, unchanged public/SMS rows).`);
}finally{await pg.close();}
