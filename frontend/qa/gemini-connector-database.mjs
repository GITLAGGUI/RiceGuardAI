// Synthetic, local PostgreSQL fixture. No production snapshots or network access.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export const ids = {
  owner: 'aaaaaaaa-0000-4000-8000-000000000001',
  otherOwner: 'aaaaaaaa-0000-4000-8000-000000000002',
  survey: '11111111-0000-4000-8000-000000000001',
  otherSurvey: '11111111-0000-4000-8000-000000000002',
  job: '22222222-0000-4000-8000-000000000001',
  otherJob: '22222222-0000-4000-8000-000000000002',
  source: '33333333-0000-4000-8000-000000000001',
};
export const resource = 'https://riceguardai.dev/api/advisory-mcp';
export const hash = (digit) => digit.repeat(64);
export async function createGeminiDatabase() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.profiles(id uuid primary key,role text,is_active boolean);
    create table public.rg_surveys(id uuid primary key,name text,location text,captured_at timestamptz default now(),status text,active_result_revision integer,archived_at timestamptz,field_assessment jsonb,crop_stage text default 'unknown',field_conditions text[] default '{}');
    create table public.rg_processing_jobs(id uuid primary key,survey_id uuid references rg_surveys(id),status text,manifest jsonb,result_manifest jsonb,manifest_hash text,created_at timestamptz default now());
    create table public.rg_result_revisions(id uuid primary key default gen_random_uuid(),survey_id uuid references rg_surveys(id),job_id uuid references rg_processing_jobs(id),revision integer,manifest jsonb,blb_model_version text,brown_spot_model_version text,warnings jsonb default '[]',created_at timestamptz default now(),unique(survey_id,revision));
    create table public.rg_advisory_sources(id uuid primary key,disease text,title text,version text,guidance jsonb,source_reference text,active boolean,approved_at timestamptz);
    create table public.rg_public_posts(id uuid primary key,summary text);
    create table public.rg_campaigns(id uuid primary key); create table public.rg_outbox(id uuid primary key);
    create table public.rg_finding_reviews(id uuid primary key,decision text);
  `);
  await pg.exec(await readFile(new URL('../../supabase/migrations/20261022185322_gemini_advisory_connector.sql', import.meta.url), 'utf8'));
  async function execute(op, input = {}) {
    // This is deliberately the real restricted SQL role and production RPC.
    return pg.transaction(async (tx) => {
      await tx.exec('set local role service_role');
      return (await tx.query('select public.rg_mcp_store($1,$2::jsonb) result', [op, JSON.stringify(input)])).rows[0].result;
    });
  }
  async function reset() {
    await pg.exec(`truncate rg_mcp.audit,rg_mcp.submissions,rg_mcp.tokens,rg_mcp.survey_access,rg_mcp.grants,rg_mcp.requests,rg_mcp.clients,rg_mcp.rate_limits,rg_result_revisions,rg_processing_jobs,rg_surveys,profiles,rg_advisory_sources,rg_public_posts,rg_campaigns,rg_outbox,rg_finding_reviews cascade`);
    await pg.query("insert into profiles values($1,'admin',true),($2,'admin',true)", [ids.owner, ids.otherOwner]);
    for (const [survey, job] of [[ids.survey, ids.job], [ids.otherSurvey, ids.otherJob]]) {
      await pg.query("insert into rg_surveys(id,name,location,status,active_result_revision) values($1,'Synthetic private fixture','Region II','Needs review',1)", [survey]);
      const manifest = {schema_version:'riceguard.result.v2',assets:[{source_asset_id:'fixture-asset',sha256:hash('a'),diseases:[{disease:'BLB',status:'detected',coverage_kind:'disease_region'}]}],model_bundle:{models:{BLB:{version:'fixture-v1',sha256:hash('b')}}}};
      await pg.query("insert into rg_processing_jobs(id,survey_id,status,manifest,result_manifest,manifest_hash) values($1,$2,'Needs review',$3,$3,$4)", [job,survey,JSON.stringify(manifest),hash('c')]);
      await pg.query("insert into rg_result_revisions(survey_id,job_id,revision,manifest,blb_model_version,brown_spot_model_version) values($1,$2,1,$3,'fixture-blb','fixture-brown')", [survey,job,JSON.stringify(manifest)]);
    }
    await pg.query("insert into rg_advisory_sources values($1,'BLB','Fixture guidance','v1',$2,'https://example.invalid/guidance',true,now())", [ids.source,JSON.stringify({actions:['Synthetic safe guidance only']})]);
    for (const table of ['rg_public_posts','rg_campaigns','rg_outbox','rg_finding_reviews']) {
      await pg.query(`insert into ${table}(id${table==='rg_public_posts'?',summary':table==='rg_finding_reviews'?',decision':''}) values(gen_random_uuid()${table==='rg_public_posts'?",'Existing public fixture'":table==='rg_finding_reviews'?",'uncertain'":''})`);
    }
  }
  const future = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();
  async function connect(overrides = {}) {
    const client = {owner_id:ids.owner,client_id:'fixture-client',client_name:'Gemini fixture',redirect_uri:'https://gemini.google.com/fixture/callback',secret_hash:hash('1')};
    await execute('register_client', client);
    const request_id = crypto.randomUUID();
    await execute('create_request',{request_id,client_id:client.client_id,redirect_uri:client.redirect_uri,resource,scopes:['evidence:read','advisory:submit'],state:'fixture-state',challenge:hash('2'),expires_at:future(300)});
    await execute('preview_consent',{request_id,owner_id:ids.owner});
    const consent = await execute('complete_consent',{request_id,owner_id:ids.owner,decision:'allow',survey_ids:[ids.survey],allow_images:false,code_hash:hash('3'),code_expires_at:future(300),grant_expires_at:future(86400),...overrides});
    return {...client,request_id,grant_id:consent.grant_id};
  }
  const exchangeInput = {client_id:'fixture-client',client_secret_hash:hash('1'),code_hash:hash('3'),challenge:hash('2'),redirect_uri:'https://gemini.google.com/fixture/callback',resource,access_hash:hash('4'),refresh_hash:hash('5'),access_expires_at:future(3600)};
  async function token() { const connection = await connect(); await execute('exchange_code', {...exchangeInput,access_expires_at:future(3600)}); return connection; }
  async function evidence(grant_id) { return execute('read_evidence',{grant_id,survey_id:ids.survey,job_id:ids.job,result_revision:1}); }
  async function submission(grant_id, overrides = {}) {
    const current = await evidence(grant_id);
    return {grant_id,survey_id:ids.survey,job_id:ids.job,result_revision:1,evidence_sha256:hash('a'),evidence_binding_sha256:current.evidence_binding_sha256,idempotency_key:'fixture-idempotency-0001',payload_sha256:hash('b'),payload:{source_ids:[ids.source],summary:'Synthetic private advisory'},...overrides};
  }
  async function protectedRows() {
    const rows = {};
    for (const table of ['rg_public_posts','rg_campaigns','rg_outbox','rg_finding_reviews']) rows[table]=(await pg.query(`select * from ${table} order by id`)).rows;
    return rows;
  }
  return {pg,execute,reset,future,connect,token,evidence,submission,protectedRows,exchangeInput};
}
