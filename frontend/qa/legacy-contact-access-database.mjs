// Isolated ACL/authorization regression. No live records or network access.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const pg=new PGlite();
const admin='aaaaaaaa-0000-4000-8000-000000000001';
const user='aaaaaaaa-0000-4000-8000-000000000002';
try {
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.profiles(id uuid,role text,is_active boolean);
 create table public.rg_public_posts(id uuid,approximate_lat numeric,approximate_lng numeric);
 insert into profiles values('${admin}','admin',true),('${user}','farmer',true);
 insert into rg_public_posts values(gen_random_uuid(),17.5,121.7);
 grant select on rg_public_posts to anon,authenticated;
 create function public.find_nearby_farmers(double precision,double precision,double precision default 10)
 returns table(id uuid,full_name text,phone text,barangay text,municipality text,province text,distance_km double precision)
 language sql stable security definer as $$select '${user}'::uuid,'Fixture farmer','fixture-phone','B','M','P',1.0::double precision$$;
 create function public.get_advisory_context(uuid) returns jsonb language sql stable security definer as $$select '{"farmer":{"phone":"fixture-phone"}}'::jsonb$$;
 grant execute on all functions in schema public to anon,authenticated,service_role;`);
 const migration=await readFile(new URL('../../supabase/migrations/20261023060238_legacy_contact_rpc_access.sql',import.meta.url),'utf8');
 await pg.exec(migration);
 let checks=0;
 for(const role of ['anon','authenticated']) {
  for(const query of ["select * from find_nearby_farmers(17,121)",`select get_advisory_context('${user}')`]) {
   await assert.rejects(pg.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);await tx.query(query);}),/permission denied|administrator/i); checks++;
  }
 }
 for(const role of ['authenticated','service_role']) {
  await pg.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[role==='authenticated'?admin:'']);
   assert.equal((await tx.query('select * from find_nearby_farmers(17,121)')).rows[0].phone,'fixture-phone');checks++;
   assert.equal((await tx.query(`select get_advisory_context('${user}') x`)).rows[0].x.farmer.phone,'fixture-phone');checks++;
  });
 }
 await pg.query('update profiles set is_active=false where id=$1',[admin]);
 await assert.rejects(pg.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[admin]);await tx.query('select * from find_nearby_farmers(17,121)');}),/administrator/i);checks++;
 for(const role of ['anon','authenticated']) {
  await pg.transaction(async tx=>{await tx.exec(`set local role ${role}`);assert.equal((await tx.query('select count(*) n from rg_public_posts')).rows[0].n,1);checks++;});
 }
 console.log(`PASS: ${checks} contact privacy checks; public location projection unchanged.`);
} finally {await pg.close();}
