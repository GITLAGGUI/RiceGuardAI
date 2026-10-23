import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {postgis} from '@electric-sql/pglite-postgis';
import {readFile} from 'node:fs/promises';
let pg:PGlite;
const actor='aaaaaaaa-0000-4000-8000-000000000001',survey='bbbbbbbb-0000-4000-8000-000000000001',bulletin='cccccccc-0000-4000-8000-000000000001';
const contacts=['dddddddd-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000003'];
const message='Controlled fixture only. No SMS gateway is contacted.';
beforeAll(async()=>{
 pg=new PGlite({extensions:{postgis}});
 await pg.exec(`create schema extensions;create extension postgis with schema extensions;create schema auth;
 create role anon;create role authenticated;create role service_role;
 create table auth.users(id uuid primary key);create table profiles(id uuid primary key,role text,is_active boolean);
 create table rg_surveys(id uuid primary key,lat float8,lng float8,archived_at timestamptz);
 create table rg_bulletins(id uuid primary key,survey_id uuid,status text,archived_at timestamptz,advisory_revision int,public_location_approved boolean);
 create table rg_public_posts(id uuid primary key,revision int);
 create table rg_contacts(id uuid primary key,name text,phone text,consent boolean,verified boolean);
 create table rg_farms(id uuid primary key default gen_random_uuid(),contact_id uuid,geometry extensions.geography(Point,4326));
 create table rg_campaigns(id uuid primary key default gen_random_uuid(),bulletin_id uuid,revision int,status text default 'queued',recipients int default 0,sample boolean default false,created_at timestamptz default now(),unique(bulletin_id,revision));
 create table rg_recipients(id uuid primary key default gen_random_uuid(),campaign_id uuid references rg_campaigns(id),contact_id uuid,phone text,status text default 'queued',client_message_id text unique,message_id text unique,attempts int default 0,not_before timestamptz default now(),last_attempt_at timestamptz,accepted_at timestamptz,delivered_at timestamptz,error text,created_at timestamptz default now(),unique(campaign_id,phone));
 create table rg_events(id uuid primary key default gen_random_uuid(),external_id text unique,kind text,entity_id text,actor_id uuid,detail jsonb);`);
 await pg.exec(await readFile(new URL('../../../supabase/migrations/20261005033315_sms_reviewed_delivery.sql',import.meta.url),'utf8'));
},60000);
beforeEach(async()=>{
 await pg.exec('truncate rg_recipients,rg_campaigns,rg_farms,rg_contacts,rg_public_posts,rg_bulletins,rg_surveys,rg_events,profiles,auth.users cascade;');
 await pg.query("insert into auth.users values($1)",[actor]);await pg.query("insert into profiles values($1,'admin',true)",[actor]);
 await pg.query('insert into rg_surveys values($1,17.613,121.726,null)',[survey]);
 await pg.query("insert into rg_bulletins values($1,$2,'published',null,3,true)",[bulletin,survey]);await pg.query('insert into rg_public_posts values($1,3)',[bulletin]);
 for(let i=0;i<3;i++) {
  await pg.query('insert into rg_contacts values($1,$2,$3,$4,true)',[contacts[i],`Fixture ${i}`,`+63900000000${i}`,i!==1]);
  await pg.query('insert into rg_farms(contact_id,geometry) values($1,extensions.st_setsrid(extensions.st_makepoint($2,$3),4326)::extensions.geography)',[contacts[i],i===2?122.726:121.726,17.613]);
 }
});afterAll(async()=>{await pg.close();});
async function preview(contact:string|null=null){return (await pg.query<{result:{hash:string;count:number;recipients:{id:string}[]}}>('select rg_sms_preview($1,$2,$3) as result',[bulletin,message,contact])).rows[0].result;}
async function enqueue(hash:string,revision=3,contact:string|null=null){return (await pg.query<{result:{campaign_id:string;duplicate:boolean;recipients:number}}>('select rg_sms_enqueue($1,$2,$3,$4,$5,$6) as result',[bulletin,actor,revision,hash,message,contact])).rows[0].result;}
async function stats(){return (await pg.query<{result:{counts:Record<string,number>;status:string}[]}>('select rg_sms_campaign_stats() as result')).rows[0].result;}
describe('actual isolated PostgreSQL SMS preview and enqueue contract',()=>{
 it('previews eligible contacts without writing campaigns, recipients, events or bulletin',async()=>{
  const before=(await pg.query('select * from rg_bulletins')).rows;const result=await preview();expect(result.count).toBe(1);expect(result.recipients).toEqual([expect.objectContaining({id:contacts[0]})]);
  for(const table of ['rg_campaigns','rg_recipients','rg_events'])expect((await pg.query(`select count(*)::int n from ${table}`)).rows[0].n).toBe(0);
  expect((await pg.query('select * from rg_bulletins')).rows).toEqual(before);
 });
 it('creates one frozen campaign and idempotently rejects duplicate sends',async()=>{
  const p=await preview();const first=await enqueue(p.hash);const second=await enqueue(p.hash);
  expect(first.duplicate).toBe(false);expect(second).toMatchObject({campaign_id:first.campaign_id,duplicate:true});
  expect((await pg.query('select message_text from rg_campaigns')).rows).toEqual([{message_text:message}]);
  expect((await pg.query('select count(*)::int n from rg_recipients')).rows[0].n).toBe(1);
  expect((await pg.query('select length(client_message_id)::int n from rg_recipients')).rows[0].n).toBe(32);
 });
 it('blocks stale revision, altered message hash, inactive admin and changed consent',async()=>{
  const p=await preview();await expect(enqueue(p.hash,2)).rejects.toThrow('Stale');await expect(enqueue('tampered')).rejects.toThrow('changed');
  await pg.query('update profiles set is_active=false');await expect(enqueue(p.hash)).rejects.toThrow('admin');await pg.query('update profiles set is_active=true');
  await pg.query('update rg_contacts set consent=false where id=$1',[contacts[0]]);await expect(enqueue(p.hash)).rejects.toThrow('changed');
  expect((await pg.query('select count(*)::int n from rg_campaigns')).rows[0].n).toBe(0);
 });
 it('invalidates a preview when the verified destination number changes',async()=>{
  const p=await preview();expect(p.hash).toHaveLength(64);
  await pg.query("update rg_contacts set phone='+639000000009' where id=$1",[contacts[0]]);
  await expect(enqueue(p.hash)).rejects.toThrow('changed');
 });
 it('blocks a draft, withdrawn or unpublished current revision',async()=>{
  await pg.query("update rg_bulletins set status='draft'");await expect(preview()).rejects.toThrow('active published');
  await pg.query("update rg_bulletins set status='published',archived_at=now()");await expect(preview()).rejects.toThrow('active published');
  await pg.query('update rg_bulletins set archived_at=null,advisory_revision=4');await expect(preview()).rejects.toThrow('current advisory');
 });
 it('does not fabricate farm or location eligibility for a selected contact',async()=>{
  expect((await preview(contacts[1])).count).toBe(0);expect((await preview(contacts[2])).count).toBe(0);
  await pg.query('update rg_bulletins set public_location_approved=false');expect((await preview()).count).toBe(0);
 });
 it('claims once and keeps unknown with a deterministic message ID before submit',async()=>{
  await enqueue((await preview()).hash);const id=(await pg.query<{id:string}>('select id from rg_recipients')).rows[0].id;
  expect((await pg.query('select rg_sms_claim($1) result',[id])).rows[0].result).toBe(true);
  expect((await pg.query('select rg_sms_claim($1) result',[id])).rows[0].result).toBe(false);
  const r=(await pg.query('select status,attempts,message_id=client_message_id as bound from rg_recipients')).rows[0];expect(r).toEqual({status:'unknown',attempts:1,bound:true});
 });
 it('rechecks consent inside the atomic claim after preview and enqueue',async()=>{
  await enqueue((await preview()).hash);const id=(await pg.query<{id:string}>('select id from rg_recipients')).rows[0].id;
  await pg.query('update rg_contacts set consent=false where id=$1',[contacts[0]]);
  expect((await pg.query('select rg_sms_claim($1) result',[id])).rows[0].result).toBe(false);
  expect((await pg.query('select status,attempts from rg_recipients')).rows[0]).toEqual({status:'suppressed',attempts:0});
 });
 it('reports recipient receipts instead of stale campaign state',async()=>{
  await enqueue((await preview()).hash);expect((await stats())[0]).toMatchObject({status:'queued',counts:{queued:1,delivered:0}});
  await pg.query("update rg_recipients set status='delivered',delivered_at=now()");expect((await stats())[0]).toMatchObject({status:'delivered',counts:{queued:0,delivered:1}});
  expect((await pg.query('select status from rg_campaigns')).rows[0].status).toBe('queued');
 });
 it('keeps mixed delivery results honest rather than calling a campaign delivered',async()=>{
  await pg.query('update rg_contacts set consent=true where id=$1',[contacts[1]]);await enqueue((await preview()).hash);
  await pg.query("update rg_recipients set status=case when contact_id=$1 then 'delivered' else 'failed' end",[contacts[0]]);
  expect((await stats())[0]).toMatchObject({status:'mixed',counts:{delivered:1,failed:1}});
 });
 it('does not grant guarded RPC access to anonymous or signed-in clients',async()=>{
  const names=['rg_sms_preview(uuid,text,uuid)','rg_sms_enqueue(uuid,uuid,integer,text,text,uuid,text,integer)','rg_sms_claim(uuid)','rg_sms_campaign_stats()','rg_sms_receipt(text,text,text,text,integer,text)'];
  for(const name of names)for(const role of ['anon','authenticated'])expect((await pg.query('select has_function_privilege($1,$2,\'EXECUTE\') ok',[role,name])).rows[0].ok).toBe(false);
 });
 it('requires all unique part receipts and actual sms:sent partsCount for delivery',async()=>{
  await enqueue((await preview()).hash);const row=(await pg.query<{id:string;phone:string}>('select id,phone from rg_recipients')).rows[0];await pg.query('select rg_sms_claim($1)',[row.id]);
  const messageId=(await pg.query<{message_id:string}>('select message_id from rg_recipients')).rows[0].message_id;
  const receipt=async(event:string,kind:string,parts:number|null=null,phone=row.phone)=>await pg.query('select rg_sms_receipt($1,$2,$3,$4,$5,null) result',[event,messageId,phone,kind,parts]);
  await receipt('sent-one','sms:sent',3);await receipt('part-one','sms:delivered');await receipt('part-one','sms:delivered');
  expect((await pg.query('select status,parts_expected,parts_delivered,delivered_at from rg_recipients')).rows[0]).toMatchObject({status:'sent',parts_expected:3,parts_delivered:1,delivered_at:null});
  await receipt('part-two','sms:delivered');expect((await stats())[0].counts.delivered).toBe(0);
  await receipt('wrong-phone','sms:delivered',null,'+639000000009');expect((await stats())[0].counts.delivered).toBe(0);
  await receipt('part-three','sms:delivered');expect((await stats())[0]).toMatchObject({status:'delivered',counts:{delivered:1}});
 });
 it('handles delivered callbacks preceding sent without fabricating an expected part count',async()=>{
  await enqueue((await preview()).hash);const id=(await pg.query<{id:string}>('select id from rg_recipients')).rows[0].id;await pg.query('select rg_sms_claim($1)',[id]);
  const row=(await pg.query<{message_id:string;phone:string}>('select message_id,phone from rg_recipients')).rows[0];
  for(const event of ['part-first','part-second'])await pg.query("select rg_sms_receipt($1,$2,$3,'sms:delivered',null,null)",[event,row.message_id,row.phone]);
  expect((await pg.query('select status,parts_expected,parts_delivered from rg_recipients')).rows[0]).toMatchObject({status:'unknown',parts_expected:null,parts_delivered:2});
  await pg.query("select rg_sms_receipt('sent-after-parts',$1,$2,'sms:sent',2,null)",[row.message_id,row.phone]);expect((await stats())[0].status).toBe('delivered');
 });
 it('keeps a partial multipart failure terminal after later delivered callbacks',async()=>{
  await enqueue((await preview()).hash);const id=(await pg.query<{id:string}>('select id from rg_recipients')).rows[0].id;await pg.query('select rg_sms_claim($1)',[id]);
  const row=(await pg.query<{message_id:string;phone:string}>('select message_id,phone from rg_recipients')).rows[0];
  await pg.query("select rg_sms_receipt('sent-parts',$1,$2,'sms:sent',2,null)",[row.message_id,row.phone]);
  await pg.query("select rg_sms_receipt('part-a',$1,$2,'sms:delivered',null,null)",[row.message_id,row.phone]);
  await pg.query("select rg_sms_receipt('failed-part-b',$1,$2,'sms:failed',null,'fixture carrier failure')",[row.message_id,row.phone]);
  await pg.query("select rg_sms_receipt('late-part-b',$1,$2,'sms:delivered',null,null)",[row.message_id,row.phone]);
  expect((await pg.query('select status,delivered_at from rg_recipients')).rows[0]).toEqual({status:'failed',delivered_at:null});
 });
});
