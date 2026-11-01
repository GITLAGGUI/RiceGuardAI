import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

let db: PGlite;
const actor = '11111111-1111-4111-8111-111111111111';
const survey = '22222222-2222-4222-8222-222222222222';
const job = '33333333-3333-4333-8333-333333333333';
const asset = '44444444-4444-4444-8444-444444444444';
const finding = (disease: string, decision = 'uncertain', reason = 'soil_nitrogen') => ({ source_asset_id: asset, disease, decision, reason });

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid, role text, is_active boolean);
    create table rg_assets(id uuid);
    create table rg_surveys(id uuid,status text,active_result_revision int,approved_result_revision int,
      reviewed_by uuid,reviewed_at timestamptz,stage_updated_at timestamptz,auto_status text,
      auto_mode text,auto_attempts int,auto_next_at timestamptz,auto_error text);
    create table rg_processing_jobs(id uuid,survey_id uuid,provider text,status text,result_manifest jsonb,updated_at timestamptz);
    create table rg_finding_reviews(job_id uuid,source_asset_id uuid,disease text,decision text,
      reviewed_by uuid,reviewed_at timestamptz default now(),reason text,note text,
      primary key(job_id,source_asset_id,disease));
    create table rg_events(kind text,entity_id text,actor_id uuid,detail jsonb);
    insert into profiles values('${actor}','admin',true);
    insert into rg_surveys(id,status,active_result_revision) values('${survey}','Needs review',1);
    insert into rg_processing_jobs values('${job}','${survey}','kaggle_yolo26','Needs review',
      '{"schema_version":"riceguard.result.v2","assets":[{"source_asset_id":"${asset}","diseases":[{"disease":"BLB","status":"detected"},{"disease":"Brown Spot","status":"detected"}]}]}',now());
  `);
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261026090000_uncertain_review_photo_classifier.sql', import.meta.url), 'utf8'));
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("delete from rg_finding_reviews; delete from rg_events; update rg_processing_jobs set status='Needs review'; update rg_surveys set status='Needs review';");
});
const verify = (reviews: unknown) => db.query('select rg_verify_findings($1::uuid,$2::uuid,$3::jsonb) as result', [job, actor, JSON.stringify(reviews)]);

describe('specialist Uncertain review transaction', () => {
  it('rejects two duplicate decisions that omit another detected disease', async () => {
    await expect(verify([finding('BLB'), finding('BLB')])).rejects.toThrow();
    expect((await db.query('select * from rg_finding_reviews')).rows).toHaveLength(0);
  });
  it('rejects a null review payload and does not mark a job reviewed', async () => {
    await expect(verify(null)).rejects.toThrow();
    expect((await db.query<{status:string}>('select status from rg_processing_jobs')).rows[0].status).toBe('Needs review');
  });
  it('rejects an absent verdict without changing the saved state', async () => {
    await expect(verify([{ source_asset_id: asset, disease: 'BLB' }, finding('Brown Spot')])).rejects.toThrow();
    expect((await db.query('select * from rg_finding_reviews')).rows).toHaveLength(0);
  });
  it('stores uncertain separately and includes only accepted diseases in follow-on automation', async () => {
    const r = await verify([finding('BLB'), finding('Brown Spot', 'accepted')]);
    expect(r.rows[0]).toEqual({ result: { accepted_diseases: ['Brown Spot'] } });
    const saved = await db.query('select disease,decision,reason from rg_finding_reviews order by disease');
    expect(saved.rows).toEqual([{ disease: 'BLB', decision: 'uncertain', reason: 'soil_nitrogen' }, { disease: 'Brown Spot', decision: 'accepted', reason: null }]);
  });
});
