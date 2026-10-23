// Local SQL regression: exercise the migration against executable pin guards.
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const old='09533f998a7e51ad8f44703aef1d7dee8eb91b4251681a538cabe881b5bec5b0';
const legacy='7695ca57f8d093c05fe73c916bb9c13315b615b6210ef76343dae0423a84ab62';
const next='df3d156e64d778ea818fdb34005a340570661d40e0d9a306ec891087f68a35de';
const sql=await readFile(new URL('../../supabase/migrations/20261023051943_gemini_visual_workflow_pin.sql',import.meta.url),'utf8');
const pg=new PGlite();let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function setup(dispatchHash=old,callbackHash=old){
 await pg.exec(`drop schema public cascade;create schema public;
 create table public.rg_processing_jobs(id uuid,provider text,status text,manifest jsonb,result_manifest jsonb);
 insert into public.rg_processing_jobs values('11111111-0000-4000-8000-000000000001','kaggle_yolo26','Needs review','{"pinned_workflow_sha256":"${old}"}','{"unchanged":true}');
 create function public.rg_claim_dispatch_v2(text,integer) returns text language plpgsql as $f$ begin return '${dispatchHash}';end $f$;
 create function public.rg_complete_pinned_job(p_job uuid,p_sequence bigint,p_manifest jsonb) returns integer language plpgsql as $f$
 declare j public.rg_processing_jobs;
 begin select * into j from public.rg_processing_jobs where id=p_job;
 if coalesce(j.manifest->>'pinned_workflow_sha256', '') not in ('${legacy}', '${callbackHash}') then raise exception 'Pinned Kaggle job not found';end if;
 if p_manifest#>>'{model_bundle,workflow_sha256}' is distinct from j.manifest->>'pinned_workflow_sha256' then raise exception 'Unverified pinned result contract';end if;
 return 1;end $f$;`);
}
const migrate=()=>pg.transaction(tx=>tx.exec(sql));
try{
 await setup();const before=(await pg.query('select * from rg_processing_jobs')).rows;
 await migrate();eq((await pg.query("select rg_claim_dispatch_v2('test',90) hash")).rows[0].hash,next);
 eq((await pg.query('select * from rg_processing_jobs')).rows,before);
 await migrate();eq((await pg.query("select rg_claim_dispatch_v2('test',90) hash")).rows[0].hash,next);
 for(const hash of [legacy,old,next]){
  await pg.query('update rg_processing_jobs set manifest=$1',[{pinned_workflow_sha256:hash}]);
  eq((await pg.query('select rg_complete_pinned_job(id,1,$1) result from rg_processing_jobs',[{model_bundle:{workflow_sha256:hash}}])).rows[0].result,1);
  await assert.rejects(pg.query('select rg_complete_pinned_job(id,1,$1) from rg_processing_jobs',[{model_bundle:{workflow_sha256:'bad'}}]),/contract/);checks++;
 }
 await pg.query('update rg_processing_jobs set manifest=$1',[{pinned_workflow_sha256:'e'.repeat(64)}]);
 await assert.rejects(pg.query('select rg_complete_pinned_job(id,1,$1) from rg_processing_jobs',[{}]),/not found/);checks++;
 for(const status of ['Queued','Submitting','Running','Waiting for GPU','Validating results']){
  await setup();await pg.query('update rg_processing_jobs set status=$1',[status]);
  await assert.rejects(migrate(),/Drain/);checks++;
  eq((await pg.query("select rg_claim_dispatch_v2('test',90) hash")).rows[0].hash,old);
 }
 for(const [a,b] of [['e'.repeat(64),old],[old,'e'.repeat(64)]]){
  await setup(a,b);await assert.rejects(migrate(),/Unexpected/);checks++;
  eq((await pg.query("select rg_claim_dispatch_v2('test',90) hash")).rows[0].hash,a);
 }
 console.log(`PASS: ${checks} workflow-pin SQL checks; no live jobs or database changed.`);
}finally{await pg.close();}
