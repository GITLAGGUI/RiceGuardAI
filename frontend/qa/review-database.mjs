// Isolated PostgreSQL fixture. No network, live credentials, uploads or inference.
import {PGlite} from '@electric-sql/pglite';
import {postgis} from '@electric-sql/pglite-postgis';
import {readFile} from 'node:fs/promises';
export const ids={actor:'aaaaaaaa-0000-4000-8000-000000000001',survey:'11111111-0000-4000-8000-000000000001',bulletin:'22222222-0000-4000-8000-000000000001',job:'33333333-0000-4000-8000-000000000001',asset:'44444444-0000-4000-8000-000000000001',otherSurvey:'55555555-0000-4000-8000-000000000002',otherBulletin:'66666666-0000-4000-8000-000000000002',source1:'77777777-0000-4000-8000-000000000001',source2:'88888888-0000-4000-8000-000000000002'};
export async function createReviewDatabase() {
 const pg=new PGlite({extensions:{postgis}});
 await pg.exec(`create schema extensions; create extension postgis with schema extensions;
 create role anon; create role authenticated; create role service_role;
 create table profiles(id uuid primary key,role text,is_active boolean,full_name text);
 create table rg_surveys(id uuid primary key,name text,location text,captured_at timestamptz default now(),camera text default 'Fixture',photos integer default 1,status text,severity text default 'not_calibrated' check(severity in('low','moderate','high','not_calibrated','unknown')),lat double precision,lng double precision,active_result_revision integer,approved_result_revision integer,location_status text,field_assessment jsonb,stage_updated_at timestamptz default now(),archived_at timestamptz);
 create table rg_bulletins(id uuid primary key,survey_id uuid references rg_surveys(id),slug text unique,title text,location text,disease text,diseases text[],severity text default 'not_calibrated',body text,action text,limitations text default 'Controlled fixture; no agronomic advice.',image text,date date default current_date,status text default 'draft',advisory_revision integer default 1,result_revision integer default 1,recipient_preview_hash text,media_approved boolean default false,public_location_approved boolean default false,lat double precision,lng double precision,public_media jsonb default '[]',advisory_source_ids uuid[],reviewer text,reviewer_id uuid,correction_note text,published_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),archived_at timestamptz);
 create table rg_processing_jobs(id uuid primary key,survey_id uuid,result_manifest jsonb,created_at timestamptz default now(),status text,provider text default 'kaggle_yolo26');
 create table rg_finding_reviews(job_id uuid,source_asset_id uuid,disease text,decision text,primary key(job_id,source_asset_id,disease));
 create table rg_coverage(geometry extensions.geometry(MultiPolygon,4326));
 create table rg_advisory_sources(id uuid primary key,disease text,active boolean default true,title text,source_reference text);
 create table rg_events(id uuid default gen_random_uuid(),kind text,entity_id text,actor_id uuid,detail jsonb,created_at timestamptz default now());
 create table rg_public_posts(id uuid primary key,slug text unique,title text,approximate_location text,disease text,assessment_label text,summary text,recommended_actions text,limitations text,cover_url text,media jsonb,reviewer_name text,approximate_lat numeric,approximate_lng numeric,revision integer,correction_note text,published_at timestamptz,updated_at timestamptz);
 create table rg_campaigns(id uuid); create table rg_outbox(id uuid);`);
 await pg.exec(await readFile(new URL('../../supabase/migrations/20261001093000_preserve_correction_gallery.sql',import.meta.url),'utf8'));
 // Exact current production publisher and four real table triggers, exercised
 // against controlled fixtures only. No production rows are loaded.
 await pg.exec(await readFile(new URL('../../qa/releases/guided-review-20261005/production-contract.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../../supabase/migrations/20261004155513_guided_review_workflow.sql',import.meta.url),'utf8'));
 const boundary=JSON.parse(await readFile(new URL('../public/data/region-ii-boundary.geojson',import.meta.url),'utf8'));
 for(const feature of boundary.features) await pg.query('insert into rg_coverage values(extensions.st_multi(extensions.st_geomfromgeojson($1)))',[JSON.stringify(feature.geometry)]);
 async function reset({reviewed=true,coordinates=true}={}) {
  await pg.exec('truncate rg_events,rg_public_posts,rg_finding_reviews,rg_processing_jobs,rg_bulletins,rg_surveys,profiles,rg_advisory_sources,rg_campaigns,rg_outbox;');
  await pg.query("insert into profiles values($1,'admin',true,'Fixture reviewer')",[ids.actor]);
  for(const [id,disease] of [[ids.source1,'BLB'],[ids.source2,'Brown Spot']]) await pg.query('insert into rg_advisory_sources(id,disease,title,source_reference) values($1,$2,$3,$4)',[id,disease,'Controlled guidance fixture','https://example.invalid/fixture']);
  for(const [survey,bulletin] of [[ids.survey,ids.bulletin],[ids.otherSurvey,ids.otherBulletin]]) {
   await pg.query(`insert into rg_surveys(id,name,location,status,lat,lng,active_result_revision,approved_result_revision,location_status) values($1,'Controlled test survey','Tuguegarao test area',$2,$3,$4,1,$5,$6)`,[survey,reviewed?'Reviewed':'Needs review',coordinates?17.613: null,coordinates?121.726:null,reviewed?1:null,coordinates?'verified':'missing']);
   await pg.query(`insert into rg_bulletins(id,survey_id,slug,title,location,disease,diseases,body,action,media_approved,public_media,advisory_source_ids,image) values($1,$2,$3,'Controlled advisory fixture','Tuguegarao test area','BLB',array['BLB','Brown Spot'],'Fixture wording for workflow testing only.','Do not use this synthetic fixture as agricultural guidance.',$4,$5,$6,'/evidence/tiled-4k-smoke-preview.jpg')`,[bulletin,survey,'fixture-'+bulletin.slice(0,8),reviewed,JSON.stringify([{url:'/evidence/tiled-4k-smoke-preview.jpg',type:'image',alt:'Archived overlay used only for isolated workflow QA'}]),[ids.source1,ids.source2]]);
  }
  await pg.query('insert into rg_processing_jobs(id,survey_id,status,result_manifest) values($1,$2,$3,$4)',[ids.job,ids.survey,reviewed?'Reviewed':'Needs review',JSON.stringify({schema_version:'riceguard.result.v2',assets:[{source_asset_id:ids.asset,kind:'image',width:1024,height:1024,diseases:[{disease:'BLB',status:'detected',predicted_pixels:20},{disease:'Brown Spot',status:'detected',predicted_pixels:10}]}]})]);
  if(reviewed)for(const d of ['BLB','Brown Spot'])await pg.query("insert into rg_finding_reviews values($1,$2,$3,'accepted')",[ids.job,ids.asset,d]);
 }
 async function readiness(id=ids.bulletin){return(await pg.query('select rg_review_readiness($1) as result',[id])).rows[0].result;}
 async function saveSeverity(entries,revision=1,id=ids.bulletin,actor=ids.actor){return(await pg.query('select rg_save_severity_review($1,1,$2,$3,$4) as result',[id,revision,actor,JSON.stringify(entries)])).rows[0].result;}
 async function saveLocation(choice,revision,id=ids.bulletin){return(await pg.query('select rg_save_review_location($1,$2,$3,$4) as result',[id,revision,ids.actor,JSON.stringify(choice)])).rows[0].result;}
 async function publish(revision,id=ids.bulletin){return(await pg.query('select rg_publish_bulletin_v2($1,$2,$3,null) as result',[id,ids.actor,revision])).rows[0].result;}
 async function snapshot(){
  const surveys=(await pg.query('select * from rg_surveys order by id')).rows;
  const bulletins=(await pg.query('select * from rg_bulletins order by id')).rows;
  const jobs=(await pg.query('select * from rg_processing_jobs order by created_at desc')).rows;
  for(const j of jobs){j.finding_reviews=(await pg.query('select source_asset_id,disease,decision from rg_finding_reviews where job_id=$1',[j.id])).rows;j.review_urls={[ids.asset]:{combined:'/evidence/tiled-4k-smoke-preview.jpg'}};}
  return{surveys,bulletins,jobs,assets:[],contacts:[],campaigns:[],models:[],providers:{drive:'configuration_required',kaggle:'configuration_required',sms:'configuration_required',advisory:'configuration_required'}};
 }
 async function operation(action,p={}) {
  if(action==='snapshot')return snapshot();
  if(action==='review-readiness')return readiness(p.id);
  if(action==='save-severity-review')return saveSeverity(p.entries,p.advisory_revision,p.id);
  if(action==='save-location')return saveLocation(p.choice,p.advisory_revision,p.id);
  if(action==='advisory-guidance')return{approved:(await pg.query('select * from rg_advisory_sources')).rows};
  if(action==='save-draft'){
   const saved=await pg.query(`update rg_bulletins set title=$3,body=$4,action=$5,context_review_required=false,advisory_revision=advisory_revision+1,updated_at=now() where id=$1 and advisory_revision=$2 and status='draft' returning advisory_revision`,[p.id,p.advisory_revision,p.title,p.body,p.action]);
   if(!saved.rows.length)throw new Error('Stale advisory revision. Reload before saving.');return saved.rows[0];
  }
  if(action==='publish'){await publish(p.advisory_revision,p.id);return{published:true,sms_enqueued:false,...await readiness(p.id)};}
  if(action==='create-correction'){
   const saved=await pg.query("update rg_bulletins set status='draft',correction_note=$3,advisory_revision=advisory_revision+1 where id=$1 and advisory_revision=$2 and status='published' returning advisory_revision",[p.id,p.advisory_revision,p.correction_note]);
   if(!saved.rows.length)throw new Error('Stale or unpublished advisory');return saved.rows[0];
  }
  if(action==='review-survey'){
   // Controlled fixture adapter for the existing image-review action, not a new model result.
   await pg.transaction(async tx=>{
    const changed=await tx.query("update rg_surveys set status='Reviewed',approved_result_revision=1,stage_updated_at=now() where id=$1 and active_result_revision=$2 and status='Needs review' returning id",[p.id,p.result_revision]);
    if(!changed.rows.length || !p.media_approved)throw new Error('Stale or incomplete image review');
    for(const r of p.reviews||[])await tx.query('insert into rg_finding_reviews values($1,$2,$3,$4)',[ids.job,r.source_asset_id,r.disease,r.decision]);
    await tx.query('update rg_bulletins set media_approved=true where survey_id=$1',[p.id]);await tx.query("update rg_processing_jobs set status='Reviewed' where survey_id=$1",[p.id]);
   });return{reviewed:true};
  }
  throw new Error('This action is not permitted by the isolated QA adapter: '+action);
 }
 await reset();return{pg,reset,readiness,saveSeverity,saveLocation,publish,snapshot,operation};
}
