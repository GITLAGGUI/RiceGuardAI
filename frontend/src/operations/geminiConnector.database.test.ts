import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error Isolated development-only PostgreSQL fixture.
import { createGeminiDatabase, ids, resource, hash } from '../../qa/gemini-connector-database.mjs';
import { createConnectorStore } from '../../../supabase/functions/_shared/geminiConnector/store';
let db: Awaited<ReturnType<typeof createGeminiDatabase>>;
beforeAll(async () => { db = await createGeminiDatabase(); }, 60000);
beforeEach(async () => { await db.reset(); });
afterAll(async () => { await db?.pg.close(); });
describe('Gemini connector actual private PostgreSQL transitions', () => {
  it('caps tokens to a still-valid grant during its final hour', async () => {
    const c=await db.connect({grant_expires_at:new Date(Date.now()+600000).toISOString()});
    await db.execute('exchange_code',{...db.exchangeInput,access_expires_at:new Date(Date.now()+3599000).toISOString()});
    let tokens=(await db.pg.query("select t.expires_at <= g.expires_at bounded from rg_mcp.tokens t join rg_mcp.grants g on g.id=t.grant_id where g.id=$1",[c.grant_id])).rows;
    expect(tokens.every((row:{bounded:boolean})=>row.bounded)).toBe(true);
    await db.execute('rotate_refresh',{client_id:db.exchangeInput.client_id,client_secret_hash:hash('1'),resource,old_refresh_hash:hash('5'),access_hash:hash('6'),refresh_hash:hash('7'),access_expires_at:new Date(Date.now()+3599000).toISOString()});
    tokens=(await db.pg.query("select t.expires_at <= g.expires_at bounded from rg_mcp.tokens t join rg_mcp.grants g on g.id=t.grant_id where g.id=$1",[c.grant_id])).rows;
    expect(tokens.every((row:{bounded:boolean})=>row.bounded)).toBe(true);
  });
  it('denies anonymous/authenticated RPC and private table access at SQL role level', async () => {
    for (const role of ['anon','authenticated']) {
      expect((await db.pg.query("select has_function_privilege($1,'public.rg_mcp_store(text,jsonb)','execute') ok",[role])).rows[0].ok).toBe(false);
      await expect(db.pg.transaction(async tx => {await tx.exec(`set local role ${role}`); await tx.query('select * from rg_mcp.grants');})).rejects.toThrow('permission denied');
    }
    expect((await db.pg.query("select has_function_privilege('service_role','public.rg_mcp_store(text,jsonb)','execute') ok")).rows[0].ok).toBe(true);
    expect((await db.pg.query("select prosecdef from pg_proc where oid='public.rg_mcp_store(text,jsonb)'::regprocedure")).rows[0].prosecdef).toBe(false);
    expect((await db.pg.query("select has_column_privilege('service_role','public.profiles','role','update') ok")).rows[0].ok).toBe(false);
  });
  it('binds consent to the previewed owner and consumes it once', async () => {
    const c=await db.connect();
    await expect(db.execute('complete_consent',{request_id:c.request_id,owner_id:ids.owner,decision:'allow',survey_ids:[ids.survey],allow_images:false,code_hash:hash('6'),code_expires_at:db.future(300),grant_expires_at:db.future(86400)})).rejects.toThrow();
    expect((await db.execute('owner_grants',{owner_id:ids.otherOwner})).grants).toHaveLength(0);
    expect((await db.execute('owner_grants',{owner_id:ids.owner})).grants).toHaveLength(1);
  });
  it('preserves a bounded 2048-character OAuth state without truncation', async () => {
    const c=await db.connect();const request_id=crypto.randomUUID();const state='s'.repeat(2048);
    await db.execute('create_request',{request_id,client_id:c.client_id,redirect_uri:c.redirect_uri,resource,scopes:['evidence:read'],state,challenge:hash('2'),expires_at:db.future(300)});
    expect((await db.pg.query('select state from rg_mcp.requests where id=$1',[request_id])).rows[0].state).toBe(state);
  });
  it('enforces exact OAuth client, redirect, resource, PKCE and one-use code', async () => {
    await db.connect();
    for (const bad of [{resource:'https://foreign.invalid/mcp'},{challenge:hash('9')},{redirect_uri:'https://foreign.invalid/callback'},{client_secret_hash:hash('9')}]) await expect(db.execute('exchange_code',{...db.exchangeInput,...bad})).rejects.toThrow();
    await db.execute('exchange_code',db.exchangeInput);
    await expect(db.execute('exchange_code',{...db.exchangeInput,access_hash:hash('6'),refresh_hash:hash('7')})).rejects.toThrow();
    expect((await db.execute('access_context',{access_hash:hash('4'),resource})).owner_id).toBe(ids.owner);
    await expect(db.execute('access_context',{access_hash:hash('4'),resource:'https://foreign.invalid/mcp'})).rejects.toThrow();
  });
  it('returns committed invalid_grant and revokes the refresh family on reuse', async () => {
    const c=await db.token();
    const rotate={client_id:c.client_id,client_secret_hash:hash('1'),old_refresh_hash:hash('5'),resource,access_hash:hash('6'),refresh_hash:hash('7'),access_expires_at:db.future(3600)};
    await db.execute('rotate_refresh',rotate);
    expect(await db.execute('rotate_refresh',{...rotate,access_hash:hash('8'),refresh_hash:hash('9')})).toEqual({error:'invalid_grant'});
    expect((await db.pg.query('select revoked_at is not null revoked from rg_mcp.grants where id=$1',[c.grant_id])).rows[0].revoked).toBe(true);
    expect((await db.pg.query('select count(*)::int n from rg_mcp.tokens')).rows[0].n).toBe(4);
    await expect(db.execute('access_context',{access_hash:hash('6'),resource})).rejects.toThrow();
  });
  it('converts a committed reuse sentinel into ConnectorError without rolling revocation back', async () => {
    const c=await db.token();
    // Real PostgreSQL behind the adapter boundary, including its committed writes.
    const store=createConnectorStore({rpc:async (_name,args) => ({data:await db.execute(args.p_operation,args.p_input),error:null})});
    const input={client_id:c.client_id,client_secret_hash:hash('1'),old_refresh_hash:hash('5'),resource,access_hash:hash('6'),refresh_hash:hash('7'),access_expires_at:db.future(3600)};
    await store.execute({op:'rotate_refresh',input});
    await expect(store.execute({op:'rotate_refresh',input:{...input,access_hash:hash('8'),refresh_hash:hash('9')}})).rejects.toMatchObject({name:'ConnectorError',code:'invalid_grant'});
    expect((await db.pg.query('select revoked_at is not null revoked from rg_mcp.grants where id=$1',[c.grant_id])).rows[0].revoked).toBe(true);
  });
  it('consumes a denial without a grant and refuses an expired authorization code', async () => {
    const denied=await db.connect({decision:'deny',code_hash:null});expect(denied.grant_id).toBe(null);
    expect((await db.pg.query('select count(*)::int n from rg_mcp.grants')).rows[0].n).toBe(0);
    await expect(db.execute('exchange_code',db.exchangeInput)).rejects.toThrow();
    await db.reset();await db.connect();await db.pg.exec("update rg_mcp.grants set code_expires_at=now()-interval '1 second'");
    await expect(db.execute('exchange_code',db.exchangeInput)).rejects.toThrow();
    expect((await db.pg.query('select count(*)::int n from rg_mcp.tokens')).rows[0].n).toBe(0);
  });
  it('requires separate read and submit scopes inside the SQL boundary', async () => {
    const c=await db.token();const input=await db.submission(c.grant_id);
    await db.pg.exec("update rg_mcp.grants set scopes=array['evidence:read']");
    await expect(db.execute('save_submission',input)).rejects.toThrow('insufficient');
    await db.pg.exec("update rg_mcp.grants set scopes=array['advisory:submit']");
    for (const [op,args] of [['read_evidence',{survey_id:ids.survey,job_id:ids.job,result_revision:1}],['queue_summary',{}],['list_evidence',{limit:20,after:null}]] as const) await expect(db.execute(op,{grant_id:c.grant_id,...args})).rejects.toThrow('insufficient');
    expect((await db.execute('save_submission',input)).status).toBe('stored_private');
  });
  it('rechecks owner activation and client/grant/token expiration on each access', async () => {
    await db.token();
    await db.pg.query('update profiles set is_active=false where id=$1',[ids.owner]);
    await expect(db.execute('access_context',{access_hash:hash('4'),resource})).rejects.toThrow();
    await db.pg.query('update profiles set is_active=true where id=$1',[ids.owner]);
    for (const sql of ["update rg_mcp.clients set expires_at=now()-interval '1 second'","update rg_mcp.grants set created_at=now()-interval '2 days',expires_at=now()-interval '1 second'","update rg_mcp.tokens set expires_at=now()-interval '1 second'"]) {
      await db.pg.exec(sql); await expect(db.execute('access_context',{access_hash:hash('4'),resource})).rejects.toThrow();
      await db.pg.exec("update rg_mcp.clients set expires_at=now()+interval '10 days'; update rg_mcp.grants set expires_at=now()+interval '1 day'; update rg_mcp.tokens set expires_at=now()+interval '1 hour'");
      expect((await db.execute('access_context',{access_hash:hash('4'),resource})).owner_id).toBe(ids.owner);
    }
  });
  it('denies out-of-scope, archived, stale and survey-revoked evidence', async () => {
    const c=await db.token();
    await expect(db.execute('read_evidence',{grant_id:c.grant_id,survey_id:ids.otherSurvey,job_id:ids.otherJob,result_revision:1})).rejects.toThrow();
    await db.pg.query('update rg_surveys set archived_at=now() where id=$1',[ids.survey]);await expect(db.evidence(c.grant_id)).rejects.toThrow();
    await db.pg.query('update rg_surveys set archived_at=null,active_result_revision=2 where id=$1',[ids.survey]);await expect(db.evidence(c.grant_id)).rejects.toThrow();
    await db.pg.query('update rg_surveys set active_result_revision=1 where id=$1',[ids.survey]);
    await db.pg.query('update rg_mcp.survey_access set revoked_at=now()');await expect(db.evidence(c.grant_id)).rejects.toThrow();
  });
  it('creates one private row under simultaneous identical requests without publication side effects', async () => {
    const c=await db.token();const before=await db.protectedRows();const input=await db.submission(c.grant_id);
    const results=await Promise.all([db.execute('save_submission',input),db.execute('save_submission',input)]);
    expect(results.map(r=>r.duplicate).sort()).toEqual([false,true]);expect(results[0].submission_id).toBe(results[1].submission_id);
    expect(results[0].status).toBe('stored_private');expect(results[0].public_post_created).toBe(false);expect(results[0].sms_enqueued).toBe(false);
    expect((await db.pg.query('select count(*)::int n from rg_mcp.submissions')).rows[0].n).toBe(1);
    expect(await db.protectedRows()).toEqual(before);
    await expect(db.execute('save_submission',{...input,evidence_sha256:hash('f')})).rejects.toThrow('conflict');
    await expect(db.execute('save_submission',{...input,payload:{summary:'Changed body'},payload_sha256:hash('c')})).rejects.toThrow('conflict');
  });
  it('does not infer a configured Gemini Task model from the connector or model self-report', async () => {
    const c=await db.token();const input=await db.submission(c.grant_id);
    await db.execute('save_submission',{...input,payload:{...input.payload,model_self_reported:'4 Argon'}});
    expect((await db.pg.query('select configured_task_model from rg_mcp.submissions')).rows[0].configured_task_model).toBe(null);
  });
  it('rejects in-place guidance, context and media-hash changes atomically at submission', async () => {
    const c=await db.token();
    const changes=["update rg_advisory_sources set guidance='{\"actions\":[\"Changed in place\"]}'", "update rg_surveys set field_assessment='{\"crop_stage\":\"changed\"}'", "update rg_processing_jobs set manifest_hash=repeat('d',64)"];
    for (const sql of changes) {const input=await db.submission(c.grant_id);await db.pg.exec(sql);await expect(db.execute('save_submission',input)).rejects.toThrow('evidence');}
    expect((await db.pg.query('select count(*)::int n from rg_mcp.submissions')).rows[0].n).toBe(0);
  });
  it('binds separately stored agronomic context even when the result revision stays unchanged', async () => {
    const c=await db.token();const input=await db.submission(c.grant_id);
    await db.pg.exec("update rg_surveys set crop_stage='vegetative',field_conditions=array['standing_water']");
    await expect(db.execute('save_submission',input)).rejects.toThrow('evidence');
    expect((await db.pg.query('select count(*)::int n from rg_mcp.submissions')).rows[0].n).toBe(0);
  });
  it('denies stale retries, invented source IDs and wrong revision/job pairs', async () => {
    const c=await db.token();const input=await db.submission(c.grant_id);await db.execute('save_submission',input);
    await expect(db.execute('save_submission',{...input,payload:{source_ids:[ids.otherSurvey]}})).rejects.toThrow();
    await expect(db.execute('save_submission',{...input,job_id:ids.otherJob})).rejects.toThrow();
    await db.pg.query('update rg_surveys set active_result_revision=2 where id=$1',[ids.survey]);await expect(db.execute('save_submission',input)).rejects.toThrow();
  });
  it('filters the queue and pagination to explicitly consented current revisions', async () => {
    const c=await db.token();expect((await db.execute('queue_summary',{grant_id:c.grant_id})).ready).toBe(1);
    const list=await db.execute('list_evidence',{grant_id:c.grant_id,limit:1,after:null});expect(list.revisions).toHaveLength(1);expect(list.revisions[0].survey_id).toBe(ids.survey);
    await expect(db.execute('list_evidence',{grant_id:c.grant_id,limit:21,after:null})).rejects.toThrow();
  });
  it('revokes only the requesting owner/client and returns non-enumerating receipts', async () => {
    const c=await db.token();
    expect(await db.execute('revoke',{mode:'owner',owner_id:ids.otherOwner,grant_id:c.grant_id})).toEqual({revoked:true});expect((await db.evidence(c.grant_id)).revision.revision).toBe(1);
    await db.execute('revoke',{mode:'owner',owner_id:ids.owner,grant_id:c.grant_id});await expect(db.evidence(c.grant_id)).rejects.toThrow();
    expect(await db.execute('revoke',{mode:'client',client_id:c.client_id,client_secret_hash:hash('1'),token_hash:hash('f')})).toEqual({revoked:true});
  });
  it('uses a persistent bounded rate bucket and rejects arbitrary operations', async () => {
    expect((await db.execute('rate_limit',{bucket_hash:hash('a'),window_seconds:60,max_requests:1})).allowed).toBe(true);
    const denied=await db.execute('rate_limit',{bucket_hash:hash('a'),window_seconds:60,max_requests:1});expect(denied.allowed).toBe(false);expect(denied.retry_after_seconds).toBeGreaterThan(0);
    await expect(db.execute('arbitrary_sql',{sql:'select * from profiles'})).rejects.toThrow();
  });
});
