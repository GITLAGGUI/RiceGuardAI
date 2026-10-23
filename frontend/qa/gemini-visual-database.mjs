// Synthetic local PostgreSQL proof; no production data, storage, or network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGeminiDatabase, ids, hash } from './gemini-connector-database.mjs';

const db = await createGeminiDatabase();
const { pg } = db;
// The shared connector fixture intentionally models only its own required columns.
await pg.exec("alter table rg_processing_jobs add column run_id text; update rg_processing_jobs set run_id='rg-synthetic1234'");
await pg.exec(await readFile(new URL('../../supabase/migrations/20261023010946_gemini_visual_media.sql', import.meta.url), 'utf8'));
const execute = (op, input) => pg.transaction(async tx => {
  await tx.exec('set local role service_role');
  return (await tx.query('select public.rg_mcp_visual_store($1,$2::jsonb) result', [op, JSON.stringify(input)])).rows[0].result;
});
const clone = x => structuredClone(x);
let checks = 0;
async function reject(op, input, pattern = /catalogue|visual|evidence|grant|image|permission/i) {
  await assert.rejects(execute(op, input), pattern); checks++;
}
async function fixture(count = 1, allowImages = true) {
  await db.reset();
  const assets = [], entries = [], artifacts = {};
  for (let i = 1; i <= count; i++) {
    const assetId = `33333333-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const review_paths = {};
    for (const variant of ['original', 'combined']) {
      const path = `website-inference/v2/jobs/rg-synthetic1234/outputs/${assetId}/${variant}.webp`;
      review_paths[variant] = path;
      artifacts[path] = {sha256:createHash('sha256').update(path).digest('hex')};
      entries.push({source_asset_id:assetId,image_index:i,variant,source_sha256:artifacts[path].sha256,
        path:`website-inference/v2/jobs/rg-synthetic1234/outputs/advisory-media/visual-v1/${assetId}/${variant}.jpg`,
        sha256:hash('d'),bytes:786432,width:2048,height:2048,quality:85});
    }
    assets.push({source_asset_id:assetId,kind:'image',review_paths,diseases:[]});
    // A video between photos must not shift the photo index or need derivatives.
    if (i === 1) assets.push({source_asset_id:ids.otherOwner,kind:'video',diseases:[]});
  }
  const manifest = {schema_version:'riceguard.result.v2',assets,artifacts};
  await pg.query('update rg_processing_jobs set manifest=$1,result_manifest=$1,run_id=$2 where id=$3', [JSON.stringify(manifest),'rg-synthetic1234',ids.job]);
  await pg.query('update rg_result_revisions set manifest=$1 where job_id=$2',[JSON.stringify(manifest),ids.job]);
  const grant = await db.connect({allow_images:allowImages});
  const key = {grant_id:grant.grant_id,survey_id:ids.survey,job_id:ids.job,result_revision:1};
  const catalogue = {schema_version:'riceguard.advisory.catalogue.v1',policy_version:'visual-v1',survey_id:ids.survey,job_id:ids.job,result_revision:1,entries};
  return {catalogue,key,manifest};
}
try {
  for (const count of [1, 4, 10]) {
    const {catalogue,key,manifest} = await fixture(count);
    assert.deepEqual(await execute('read_catalogue',key),{catalogue:null,catalogue_sha256:null}); checks++;
    assert.deepEqual(await execute('validate_catalogue',{catalogue}),{valid:true}); checks++;
    assert.deepEqual(await execute('validate_catalogue',{catalogue}),{valid:true}); checks++;
    assert.equal((await pg.query('select count(*) n from rg_mcp.visual_catalogues')).rows[0].n,0); checks++;
    const competing=clone(catalogue); competing.entries[0].sha256=hash('e');
    await reject('validate_catalogue',{catalogue:competing},/immutable|conflict/i);
    await reject('save_catalogue',{catalogue:competing},/immutable|conflict/i);
    assert.equal((await pg.query('select count(*) n from rg_mcp.visual_preparations')).rows[0].n,1); checks++;
    const saved = await execute('save_catalogue',{catalogue});
    assert.equal(saved.stored,true); assert.equal(saved.duplicate,false); assert.match(saved.catalogue_sha256,/^[a-f0-9]{64}$/); checks++;
    const canonical = (await pg.query('select catalogue::text value from rg_mcp.visual_catalogues')).rows[0].value;
    assert.equal(saved.catalogue_sha256,createHash('sha256').update(canonical).digest('hex')); checks++;
    assert.deepEqual(await execute('save_catalogue',{catalogue}),{...saved,duplicate:true}); checks++;
    // Preparation is allowed to retry identical bytes, but must reject a
    // changed immutable catalogue before the callback requests any PUT URLs.
    assert.deepEqual(await execute('validate_catalogue',{catalogue}),{valid:true}); checks++;
    for (const change of [{sha256:hash('e')},{bytes:123},{width:1024},{quality:75}]) {
      const conflict=clone(catalogue); Object.assign(conflict.entries[0],change);
      await reject('validate_catalogue',{catalogue:conflict},/immutable|conflict/i);
    }
    assert.deepEqual(await execute('read_catalogue',key),{catalogue,catalogue_sha256:saved.catalogue_sha256}); checks++;
    const receiptKey={...key,catalogue_sha256:saved.catalogue_sha256};
    await reject('assert_delivery',receiptKey,/incomplete/i);
    for (let i=0; i<catalogue.entries.length; i+=2) {
      const image_ids=catalogue.entries.slice(i,i+2).map(e=>`${e.source_asset_id}:${e.variant}`);
      assert.deepEqual(await execute('record_delivery',{...receiptKey,image_ids}),{recorded:true}); checks++;
      assert.deepEqual(await execute('record_delivery',{...receiptKey,image_ids}),{recorded:true}); checks++;
      if(i+2<catalogue.entries.length) await reject('assert_delivery',receiptKey,/incomplete/i);
    }
    assert.deepEqual(await execute('assert_delivery',receiptKey),{complete:true}); checks++;
    assert.equal((await pg.query('select count(*) n from rg_mcp.visual_deliveries')).rows[0].n,catalogue.entries.length); checks++;
    for (const image_ids of [[],['unknown'],[null],[1],['bad','bad'],catalogue.entries.slice(0,3).map(e=>`${e.source_asset_id}:${e.variant}`)]) {
      if(count===1 && image_ids.length===2 && image_ids[0]!==image_ids[1]) continue;
      await reject('record_delivery',{...receiptKey,image_ids});
    }
    await reject('record_delivery',{...receiptKey,catalogue_sha256:hash('e'),image_ids:[`${catalogue.entries[0].source_asset_id}:original`]});
    await reject('assert_delivery',{...receiptKey,catalogue_sha256:hash('e')});
    // Another real consent grant must not inherit the first grant's receipts.
    const client_id='fixture-client-2', request_id=crypto.randomUUID();
    const redirect_uri='https://gemini.google.com/fixture/callback';
    await db.execute('register_client',{owner_id:ids.owner,client_id,client_name:'Second fixture',redirect_uri,secret_hash:hash('8')});
    await db.execute('create_request',{request_id,client_id,redirect_uri,resource:'https://riceguardai.dev/api/advisory-mcp',scopes:['evidence:read'],state:'synthetic',challenge:hash('9'),expires_at:db.future(300)});
    await db.execute('preview_consent',{request_id,owner_id:ids.owner});
    const second=await db.execute('complete_consent',{request_id,owner_id:ids.owner,decision:'allow',survey_ids:[ids.survey],allow_images:true,code_hash:hash('6'),code_expires_at:db.future(300),grant_expires_at:db.future(3600)});
    await reject('assert_delivery',{...receiptKey,grant_id:second.grant_id},/incomplete/i);
    const changed = clone(catalogue); changed.entries[0].sha256=hash('e');
    await reject('save_catalogue',{catalogue:changed},/immutable|conflict/i);
    assert.deepEqual((await pg.query('select manifest,result_manifest from rg_processing_jobs where id=$1',[ids.job])).rows[0],{manifest,result_manifest:manifest}); checks++;
    assert.deepEqual((await pg.query('select manifest from rg_result_revisions where job_id=$1',[ids.job])).rows[0].manifest,manifest); checks++;
  }
  const {catalogue,key} = await fixture();
  for (const mutate of [
    c => c.entries.pop(),
    c => c.entries.push(clone(c.entries[0])),
    c => c.entries[1].variant='original',
    c => c.entries[1].path=c.entries[0].path,
    c => c.entries[0].source_asset_id=ids.otherOwner,
    c => c.entries[0].source_sha256=hash('e'),
    c => c.entries[0].source_sha256=hash('A'),
    c => c.entries[0].path=c.entries[0].path.replace('rg-synthetic1234','rg-other'),
    c => c.entries[0].path+='?signed=true',
    c => c.entries[0].path=c.entries[0].path.replace('/original.jpg','/../original.jpg'),
    c => c.entries[0].variant='BLB',
    c => c.entries[0].sha256=hash('A'),
    c => c.entries[0].sha256=null,
    c => c.entries[0].image_index=2,
    c => c.entries[0].image_index='1',
    c => c.entries[0].image_index=1.5,
    c => c.entries[0].bytes=0,
    c => c.entries[0].bytes=786433,
    c => c.entries[0].bytes='12',
    c => c.entries[0].bytes=1.5,
    c => c.entries[0].width=2049,
    c => c.entries[0].height=0,
    c => c.entries[0].quality=49,
    c => c.entries[0].quality=86,
    c => c.entries[0].quality=true,
    c => c.entries[0].extra='not allowed',
    c => c.entries='not an array',
    c => c.policy_version='visual-v2',
    c => c.result_revision='1',
    c => c.result_revision=null,
    c => c.job_id=ids.otherJob,
    c => c.survey_id=ids.otherSurvey,
    c => c.extra='not allowed',
  ]) { const bad=clone(catalogue); mutate(bad); await reject('save_catalogue',{catalogue:bad}); }
  assert.equal((await pg.query('select count(*) n from rg_mcp.visual_preparations')).rows[0].n,0); checks++;
  const minimum = clone(catalogue);
  for (const e of minimum.entries) Object.assign(e,{bytes:1,width:1,height:1,quality:50});
  await execute('save_catalogue',{catalogue:minimum}); checks++;
  const current=await execute('read_catalogue',key);
  const receiptKey={...key,catalogue_sha256:current.catalogue_sha256};
  await reject('read_catalogue',{...key,job_id:ids.otherJob});
  await reject('read_catalogue',{...key,survey_id:ids.otherSurvey,job_id:ids.otherJob});
  await pg.query('update rg_mcp.grants set allow_images=false where id=$1',[key.grant_id]);
  await reject('read_catalogue',key);
  await reject('record_delivery',{...receiptKey,image_ids:[`${minimum.entries[0].source_asset_id}:original`]});
  await reject('assert_delivery',receiptKey);
  await pg.query('update rg_mcp.grants set allow_images=true,scopes=$2 where id=$1',[key.grant_id,['advisory:submit']]);
  await reject('read_catalogue',key);
  await pg.query("update rg_mcp.grants set scopes=array['evidence:read'],revoked_at=now() where id=$1",[key.grant_id]);
  await reject('read_catalogue',key);
  await reject('assert_delivery',receiptKey);
  await pg.query('update rg_mcp.grants set revoked_at=null where id=$1',[key.grant_id]);
  await pg.query('update profiles set is_active=false where id=$1',[ids.owner]);
  await reject('read_catalogue',key,/owner/i);
  await pg.query('update profiles set is_active=true where id=$1',[ids.owner]);
  await pg.query('update rg_surveys set active_result_revision=2 where id=$1',[ids.survey]);
  await reject('read_catalogue',key); await reject('save_catalogue',{catalogue:minimum});
  await reject('assert_delivery',receiptKey);
  await pg.query('update rg_surveys set active_result_revision=1,archived_at=now() where id=$1',[ids.survey]);
  await reject('read_catalogue',key); await reject('save_catalogue',{catalogue:minimum});
  await pg.query('update rg_surveys set archived_at=null where id=$1',[ids.survey]);
  // Mutating both pinned copies cannot make the stored source binding silently drift.
  await pg.exec(`update rg_processing_jobs set result_manifest=jsonb_set(result_manifest,'{artifacts}', '{}'); update rg_result_revisions set manifest=(select result_manifest from rg_processing_jobs where id=job_id)`);
  await reject('read_catalogue',key);
  for (const role of ['anon','authenticated']) {
    const acl = (await pg.query(`select has_function_privilege($1,'public.rg_mcp_visual_store(text,jsonb)','execute') rpc, has_table_privilege($1,'rg_mcp.visual_catalogues','select,insert,update,delete') tbl`,[role])).rows[0];
    assert.deepEqual(acl,{rpc:false,tbl:false}); checks++;
    assert.equal((await pg.query("select has_table_privilege($1,'rg_mcp.visual_deliveries','select,insert,update,delete') allowed",[role])).rows[0].allowed,false); checks++;
    assert.equal((await pg.query("select has_table_privilege($1,'rg_mcp.visual_preparations','select,insert,update,delete') allowed",[role])).rows[0].allowed,false); checks++;
    await assert.rejects(pg.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query("select public.rg_mcp_visual_store('read_catalogue',$1)",[JSON.stringify(key)]); }),/permission denied/); checks++;
  }
  const table = (await pg.query("select relrowsecurity from pg_class where oid='rg_mcp.visual_catalogues'::regclass")).rows[0];
  assert.equal(table.relrowsecurity,true);
  assert.equal((await pg.query("select count(*) n from pg_policies where schemaname='rg_mcp' and tablename='visual_catalogues'")).rows[0].n,0); checks++;
  await assert.rejects(pg.transaction(async tx => {await tx.exec('set local role service_role'); await tx.exec('delete from rg_mcp.visual_catalogues');}),/permission denied/); checks++;
  await assert.rejects(pg.exec("update rg_mcp.visual_catalogues set catalogue=catalogue"),/immutable/i); checks++;
  await assert.rejects(pg.transaction(async tx => {await tx.exec('set local role service_role'); await tx.exec('delete from rg_mcp.visual_deliveries');}),/permission denied/); checks++;
  assert.equal((await pg.query("select relrowsecurity from pg_class where oid='rg_mcp.visual_preparations'::regclass")).rows[0].relrowsecurity,true); checks++;
  assert.equal((await pg.query("select count(*) n from pg_policies where schemaname='rg_mcp' and tablename='visual_preparations'")).rows[0].n,0); checks++;
  await assert.rejects(pg.exec("update rg_mcp.visual_preparations set catalogue_sha256=catalogue_sha256"),/immutable/i); checks++;
  await assert.rejects(pg.transaction(async tx => {await tx.exec('set local role service_role'); await tx.exec('delete from rg_mcp.visual_preparations');}),/permission denied/); checks++;
  await reject('unsupported',{});
  console.log(`PASS: ${checks} synthetic visual database checks (1/4/10 photos, strict bindings/limits, immutable rows, grant-scoped delivery receipts, ACLs, unchanged manifests).`);
} finally { await pg.close(); }
