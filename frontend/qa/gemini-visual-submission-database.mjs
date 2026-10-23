// Synthetic PostgreSQL proof. The baseline switch reproduces the old production
// RPC's duplicate defect; normal runs exercise the additive visual wrapper.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGeminiDatabase, ids, hash, resource } from './gemini-connector-database.mjs';

const db = await createGeminiDatabase(), { pg } = db;
const baseline = process.argv.includes('--baseline');
const migration = '../../supabase/migrations/20261023053844_gemini_visual_submission_dedup.sql';
await pg.exec('alter table rg_processing_jobs add column run_id text');
await pg.exec(await readFile(new URL('../../supabase/migrations/20261023010946_gemini_visual_media.sql', import.meta.url), 'utf8'));
if (!baseline) await pg.exec(await readFile(new URL(migration, import.meta.url), 'utf8'));
const rpc = (name, op, input) => pg.transaction(async tx => {
  await tx.exec('set local role service_role');
  return (await tx.query(`select public.${name}($1,$2::jsonb) result`, [op, JSON.stringify(input)])).rows[0].result;
});
const visual = (op, input) => rpc('rg_mcp_visual_store', op, input);
const submit = input => rpc(baseline ? 'rg_mcp_store' : 'rg_mcp_visual_submission_store', 'save_submission', input);
let checks = 0;
const check = (value, expected) => { assert.deepEqual(value, expected); checks++; };
const reject = async (input, pattern = /grant|scope|image|delivery|evidence|stale|outside|owner|conflict|policy/i) => {
  await assert.rejects(submit(input), pattern); checks++;
};
async function secondGrant(owner = ids.owner, images = true) {
  const client_id = crypto.randomUUID(), request_id = crypto.randomUUID();
  const redirect_uri = 'https://gemini.google.com/fixture/callback';
  await db.execute('register_client', {owner_id:owner,client_id,client_name:'Renewed fixture',redirect_uri,secret_hash:crypto.randomUUID().replaceAll('-','').repeat(2)});
  await db.execute('create_request', {request_id,client_id,redirect_uri,resource,scopes:['evidence:read','advisory:submit'],state:'fixture',challenge:hash('9'),expires_at:db.future(300)});
  await db.execute('preview_consent', {request_id,owner_id:owner});
  return (await db.execute('complete_consent', {request_id,owner_id:owner,decision:'allow',survey_ids:[ids.survey],allow_images:images,code_hash:crypto.randomUUID().replaceAll('-','').repeat(2),code_expires_at:db.future(300),grant_expires_at:db.future(3600)})).grant_id;
}
async function prepare(revision = 1, grant_id) {
  const root = 'website-inference/v2/jobs/rg-synthetic1234/outputs';
  const entries = ['original','combined'].map(variant => ({source_asset_id:ids.source,image_index:1,variant,source_sha256:hash('a'),path:`${root}/advisory-media/visual-v1/${ids.source}/${variant}.jpg`,sha256:hash('d'),bytes:100,width:10,height:10,quality:85}));
  const manifest = {schema_version:'riceguard.result.v2',assets:[{source_asset_id:ids.source,kind:'image',review_paths:{original:`${root}/original.jpg`,combined:`${root}/combined.jpg`},diseases:[{disease:'BLB',status:'detected',predicted_pixels:10}]}],artifacts:{[`${root}/original.jpg`]:{sha256:hash('a')},[`${root}/combined.jpg`]:{sha256:hash('a')}}};
  await pg.query('update rg_processing_jobs set manifest=$1,result_manifest=$1,run_id=$2 where id=$3',[JSON.stringify(manifest),'rg-synthetic1234',ids.job]);
  if (revision === 1) await pg.query('update rg_result_revisions set manifest=$1 where job_id=$2',[JSON.stringify(manifest),ids.job]);
  else {
    await pg.query('insert into rg_result_revisions(survey_id,job_id,revision,manifest) values($1,$2,$3,$4)',[ids.survey,ids.job,revision,JSON.stringify(manifest)]);
    await pg.query('update rg_surveys set active_result_revision=$1 where id=$2',[revision,ids.survey]);
  }
  grant_id ??= (await db.connect({allow_images:true})).grant_id;
  const key = {grant_id,survey_id:ids.survey,job_id:ids.job,result_revision:revision};
  const catalogue = {schema_version:'riceguard.advisory.catalogue.v1',policy_version:'visual-v1',survey_id:ids.survey,job_id:ids.job,result_revision:revision,entries};
  const saved = await visual('save_catalogue',{catalogue});
  const input = {...key,evidence_sha256:hash('a'),evidence_binding_sha256:(await db.execute('read_evidence',key)).evidence_binding_sha256,idempotency_key:'fixture-idempotency-0001',payload_sha256:hash('b'),payload:{source_ids:[ids.source],summary:'Synthetic private advisory'},catalogue_sha256:saved.catalogue_sha256,policy_version:'visual-v1'};
  const deliver = id => visual('record_delivery',{...key,grant_id:id,catalogue_sha256:saved.catalogue_sha256,image_ids:entries.map(e=>`${e.source_asset_id}:${e.variant}`)});
  return {input,deliver};
}
try {
  await db.reset();
  const {input,deliver} = await prepare();
  const protectedBefore = await db.protectedRows();
  await deliver(input.grant_id);
  // Schedule competing first submissions across distinct consent grants. PGlite
  // queues transactions on one engine; real multi-session contention is also
  // protected by the SQL transaction advisory lock plus the composite PK.
  const parallelGrant = await secondGrant();
  await deliver(parallelGrant);
  const contenders = await Promise.all(Array.from({length:8},(_,i)=>submit({...input,grant_id:i%2 ? parallelGrant : input.grant_id,idempotency_key:`first-invocation-${i}`,payload:{...input.payload,summary:`First contender ${i}`}})));
  const first = contenders[0];
  check(contenders.every(r=>r.submission_id===first.submission_id),true);
  check(contenders.filter(r=>!r.duplicate).length,1);
  const repeated = await submit({...input,idempotency_key:'different-task-retry-0002',payload_sha256:hash('f'),payload:{...input.payload,summary:'Different generated wording'}});
  check(repeated.submission_id,first.submission_id);
  check(repeated.duplicate,true);
  check((await pg.query('select count(*) n from rg_mcp.submissions')).rows[0].n,1);
  check((await pg.query('select payload from rg_mcp.submissions where id=$1',[first.submission_id])).rows[0].payload.summary,'First contender 0');
  const parallel = await Promise.all(Array.from({length:8},(_,i)=>submit({...input,idempotency_key:`parallel-invocation-${i}`,payload:{...input.payload,summary:`Retry ${i}`}})));
  check(parallel.every(r=>r.submission_id===first.submission_id && r.duplicate),true);
  check((await pg.query('select count(*) n from rg_mcp.submissions')).rows[0].n,1);
  // A renewed grant must obtain its own image receipts, then reuse the event.
  const renewed = await secondGrant();
  await reject({...input,grant_id:renewed},/incomplete/i);
  await deliver(renewed);
  check((await submit({...input,grant_id:renewed,idempotency_key:'renewed-task-key-0003'})).submission_id,first.submission_id);
  const foreign = await secondGrant(ids.otherOwner);
  await deliver(foreign);
  await reject({...input,grant_id:foreign},/owner|conflict/i);
  await reject({...input,policy_version:'visual-v2'},/policy/i);
  await reject({...input,evidence_sha256:hash('e')},/stale|conflict/i);
  await reject({...input,evidence_binding_sha256:hash('e')},/stale/i);
  await reject({...input,catalogue_sha256:hash('e')},/stale|catalogue/i);
  await reject({...input,survey_id:ids.otherSurvey,job_id:ids.otherJob},/outside/i);
  for (const mutation of [
    ["update rg_mcp.grants set revoked_at=now() where id=$1", "update rg_mcp.grants set revoked_at=null where id=$1"],
    ["update rg_mcp.grants set expires_at=now()-interval '1 second',created_at=now()-interval '1 day' where id=$1", "update rg_mcp.grants set expires_at=now()+interval '1 day' where id=$1"],
    ['update rg_mcp.grants set allow_images=false where id=$1','update rg_mcp.grants set allow_images=true where id=$1'],
    ["update rg_mcp.grants set scopes=array['evidence:read'] where id=$1", "update rg_mcp.grants set scopes=array['evidence:read','advisory:submit'] where id=$1"],
    ["update rg_mcp.grants set scopes=array['advisory:submit'] where id=$1", "update rg_mcp.grants set scopes=array['evidence:read','advisory:submit'] where id=$1"],
    ['update rg_mcp.survey_access set revoked_at=now() where grant_id=$1','update rg_mcp.survey_access set revoked_at=null where grant_id=$1'],
  ]) {
    await pg.query(mutation[0],[input.grant_id]); await reject(input); await pg.query(mutation[1],[input.grant_id]);
  }
  // Changing any bound source/context invalidates an existing receipt lookup.
  await pg.query("update rg_surveys set crop_stage='tillering' where id=$1",[ids.survey]);
  await reject(input,/stale/i);
  await pg.query("update rg_surveys set crop_stage='unknown' where id=$1",[ids.survey]);
  await pg.query('update rg_surveys set archived_at=now() where id=$1',[ids.survey]);
  await reject(input,/archived|stale/i);
  await pg.query('update rg_surveys set archived_at=null where id=$1',[ids.survey]);
  const next = await prepare(2,renewed);
  await reject(input,/stale/i);
  await next.deliver(renewed);
  const nextReceipt = await submit({...next.input,idempotency_key:input.idempotency_key});
  check(nextReceipt.submission_id===first.submission_id,false);
  check((await pg.query('select count(*) n from rg_mcp.visual_submissions')).rows[0].n,2);
  check((await pg.query("select count(*) n from rg_mcp.audit where action='save_submission'")).rows[0].n,2);
  check(await db.protectedRows(),protectedBefore);
  // The manual text path retains its caller-selected key semantics.
  const manual = {...next.input,idempotency_key:'legacy-text-submission-01'};
  const manual1 = await db.execute('save_submission',manual);
  const manual2 = await db.execute('save_submission',{...manual,idempotency_key:'legacy-text-submission-02'});
  check(manual1.submission_id===manual2.submission_id,false);
  for (const role of ['anon','authenticated']) {
    check((await pg.query("select has_function_privilege($1,'public.rg_mcp_visual_submission_store(text,jsonb)','execute') rpc,has_table_privilege($1,'rg_mcp.visual_submissions','select,insert,update,delete') tbl",[role])).rows[0],{rpc:false,tbl:false});
    await assert.rejects(pg.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query("select public.rg_mcp_visual_submission_store('save_submission',$1)",[JSON.stringify(next.input)]);}),/permission denied/); checks++;
  }
  check((await pg.query("select relrowsecurity from pg_class where oid='rg_mcp.visual_submissions'::regclass")).rows[0].relrowsecurity,true);
  await assert.rejects(pg.exec('update rg_mcp.visual_submissions set submission_id=submission_id'),/immutable/i); checks++;
  await assert.rejects(pg.transaction(async tx=>{await tx.exec('set local role service_role');await tx.exec('delete from rg_mcp.visual_submissions');}),/permission denied/); checks++;
  console.log(`PASS: ${checks} visual submission database checks (event uniqueness, retries, grant renewal, concurrent calls, current authorization/delivery/evidence, owners, revisions, legacy path, immutable ACLs).`);
} finally { await pg.close(); }
