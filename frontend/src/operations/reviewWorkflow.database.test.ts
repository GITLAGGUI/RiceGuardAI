import {beforeAll,beforeEach,afterAll,describe,expect,it} from 'vitest';
// @ts-expect-error Development-only fixture module intentionally excluded from application types.
import {createReviewDatabase,ids} from '../../qa/review-database.mjs';
import {validateSeverityReview} from '../../../supabase/functions/_shared/reviewWorkflow';
let db:Awaited<ReturnType<typeof createReviewDatabase>>;
const entries=(revision=1)=>validateSeverityReview([{disease:'BLB',basis:'reviewed_visual_estimate',category:'moderate',specialist:'Fixture assessor',notes:'Reviewed the fixture images and recorded an image-limited estimate.',confirmed:true,advisory_revision:revision},{disease:'Brown Spot',basis:'not_assessed',category:'not_assessed',specialist:'Fixture assessor',notes:'Lesions cannot be measured independently from this test overlay.',confirmed:true}]);
beforeAll(async()=>{db=await createReviewDatabase();},60000);
beforeEach(async()=>{await db.reset();});afterAll(async()=>{await db.pg.close();});
describe('actual isolated PostgreSQL review functions and public projection',()=>{
 it('starts blocked and atomically saves two diseases with one revision increment',async()=>{
  expect((await db.readiness()).ready).toBe(false);const result=await db.saveSeverity(entries());
  expect(result.advisory_revision).toBe(2);expect(result.steps[1].complete).toBe(true);
  const s=(await db.pg.query('select severity,field_assessment from rg_surveys where id=$1',[ids.survey])).rows[0];
  expect(s.severity).toBe('not_calibrated');expect(Object.keys(s.field_assessment.diseases)).toEqual(['BLB','Brown Spot']);
  expect((await db.readiness(ids.otherBulletin)).advisory_revision).toBe(1);
 });
 it('rejects partial batches without saving either disease or an audit event',async()=>{
  await expect(db.saveSeverity(entries().slice(0,1))).rejects.toThrow('every accepted disease');
  expect((await db.pg.query('select field_assessment from rg_surveys where id=$1',[ids.survey])).rows[0].field_assessment).toBe(null);
  expect((await db.pg.query('select count(*)::int n from rg_events')).rows[0].n).toBe(0);
 });
 it('rejects stale, duplicate, unconfirmed and non-admin updates',async()=>{
  await db.saveSeverity(entries());await expect(db.saveSeverity(entries())).rejects.toThrow('Stale');
  await expect(db.saveSeverity([entries(2)[0],entries(2)[0]],2)).rejects.toThrow();
  await expect(db.saveSeverity(entries(2).map(e=>({...e,confirmed:false})),2)).rejects.toThrow('confirmed');
  await db.pg.query("update profiles set role='farmer' where id=$1",[ids.actor]);await expect(db.saveSeverity(entries(2),2)).rejects.toThrow('admin');
 });
 it('binds saved reviews to the actual manifest and accepted finding decisions',async()=>{
  await db.saveSeverity(entries());await db.saveLocation({mode:'approximate_pin',confirmed:true},2);expect((await db.readiness()).ready).toBe(true);
  await db.pg.query("update rg_finding_reviews set decision='uncertain' where disease='BLB'");
  expect((await db.readiness()).steps[1].complete).toBe(false);expect((await db.readiness()).steps[2].complete).toBe(false);
 });
 it('uses real Region II geometry and rejects Manila, partial coordinates and zero-zero',async()=>{
  for(const [lat,lng] of [[14.5995,120.9842],[0,0],[17.613,null]])await expect(db.saveLocation({mode:'approximate_pin',confirmed:true,lat,lng},1)).rejects.toThrow();
  const result=await db.saveLocation({mode:'approximate_pin',confirmed:true,lat:17.613,lng:121.726},1);expect(result.steps[2].complete).toBe(true);
 });
 it('allows an explicit no-GPS no-pin publication without fabricating coordinates or SMS',async()=>{
  await db.reset({coordinates:false});await db.saveSeverity(entries());await db.saveLocation({mode:'no_pin',confirmed:true},2);
  expect((await db.readiness()).ready).toBe(true);await db.publish(3);
  const post=(await db.pg.query('select * from rg_public_posts')).rows[0];expect(post.approximate_lat).toBe(null);expect(post.approximate_lng).toBe(null);expect(post.media).toHaveLength(1);
  expect((await db.pg.query('select count(*)::int n from rg_campaigns')).rows[0].n).toBe(0);expect((await db.pg.query('select count(*)::int n from rg_outbox')).rows[0].n).toBe(0);
 });
 it('blocks incomplete review, absent sources and unreviewed changed-location wording',async()=>{
  await expect(db.publish(1)).rejects.toThrow('Complete');await db.saveSeverity(entries());
  await db.saveLocation({mode:'approximate_pin',confirmed:true,lat:17.614,lng:121.727,location:'Reviewed Tuguegarao area'},2);
  expect((await db.readiness()).steps[3].complete).toBe(false);await expect(db.publish(3)).rejects.toThrow('Complete');
  await db.operation('save-draft',{id:ids.bulletin,advisory_revision:3,title:'Reviewed location wording',body:'New location reviewed.',action:'Follow the approved guidance.'});
  expect((await db.readiness()).ready).toBe(true);await db.pg.query('update rg_advisory_sources set active=false');expect((await db.readiness()).ready).toBe(false);
 });
 it('idempotently publishes one public row and protects it throughout a correction',async()=>{
  await db.saveSeverity(entries());await db.saveLocation({mode:'approximate_pin',confirmed:true},2);await db.publish(3);await db.publish(3);
  expect((await db.pg.query('select count(*)::int n from rg_public_posts')).rows[0].n).toBe(1);
  await expect(db.saveSeverity(entries(3),3)).rejects.toThrow('correction');await expect(db.saveLocation({mode:'no_pin',confirmed:true},3)).rejects.toThrow('correction');
  const before=(await db.pg.query('select * from rg_public_posts')).rows[0];
  await db.operation('create-correction',{id:ids.bulletin,advisory_revision:3,correction_note:'Correct the test summary.'});
  await db.operation('save-draft',{id:ids.bulletin,advisory_revision:4,title:'Reviewed correction',body:'Corrected test summary.',action:'Reviewed test action.'});
  expect((await db.pg.query('select * from rg_public_posts')).rows[0]).toEqual(before);await db.publish(5);
  const after=(await db.pg.query('select * from rg_public_posts')).rows[0];expect(after.summary).toBe('Corrected test summary.');expect(after.media).toEqual(before.media);expect(after.approximate_lat).toBe('17.61');
 });
 it('leaves legacy public projections untouched and recognizes their existing pins',async()=>{
  await db.saveSeverity(entries());await db.saveLocation({mode:'approximate_pin',confirmed:true},2);await db.publish(3);
  const before=(await db.pg.query('select * from rg_public_posts')).rows;await db.pg.query('update rg_bulletins set location_review=null');
  expect((await db.readiness()).map_eligible).toBe(true);expect((await db.pg.query('select * from rg_public_posts')).rows).toEqual(before);
 });
 it('only permits the service role to invoke the guarded functions',async()=>{
  const sig='public.rg_save_severity_review(uuid,integer,integer,uuid,jsonb)';
  for(const role of ['anon','authenticated'])expect((await db.pg.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,sig])).rows[0].allowed).toBe(false);
  expect((await db.pg.query('select has_function_privilege(\'service_role\',$1,\'execute\') allowed',[sig])).rows[0].allowed).toBe(true);
  expect((await db.pg.query("select has_function_privilege('service_role','public.rg_publish_bulletin_before_guided_review(uuid,uuid,integer,text)','execute') allowed")).rows[0].allowed).toBe(false);
 });
});
