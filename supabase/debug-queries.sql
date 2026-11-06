-- =====================================================================================================
-- GABAY: Mga handang query para sa debugging ng RiceGuardAI database (PostgreSQL).
--
-- Para sa LOCAL database lang (Docker, `supabase start`). Hindi ito migration at hindi ito tumatakbo nang kusa.
-- Buksan ang file na ito sa VS Code (PostgreSQL extension), i-select ang isang query, tapos i-run.
-- Puwede rin itong i-paste sa Supabase Studio > SQL Editor (http://127.0.0.1:54323).
--
-- Koneksyon: host 127.0.0.1, port 54322, database postgres, user postgres, password postgres.
-- Tingnan ang docs/DEBUGGING_GUIDE.md, Bahagi 3, para sa paliwanag.
-- =====================================================================================================


-- ---------- 1. Ano ang laman ng database ----------

-- Lahat ng table ng RiceGuardAI at ilan ang laman ng bawat isa
select relname as table_name, n_live_tup as approx_rows
from pg_stat_user_tables
where schemaname = 'public'
order by relname;

-- Lahat ng column ng isang table (palitan ang 'rg_surveys')
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'rg_surveys'
order by ordinal_position;

-- Lahat ng database function (RPC) na ginagamit ng website at ng edge functions
select p.proname as function_name, pg_get_function_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'rg_%'
order by 1;

-- Ang kasalukuyang code ng isang function (palitan ang pangalan). Ito ang pinakabagong bersyon, kahit ilang
-- migration na ang nagbago nito.
-- (May mga function na higit sa isa ang bersyon, iba-iba ang arguments; lalabas silang lahat.)
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'rg_update_contact';


-- ---------- 2. Surveys at ang automation ----------

-- 10 pinakabagong survey, status ng GPU job at kung gaano katagal
select s.id, s.name, s.status, s.created_at,
       j.status as job_status, j.provider_state, j.progress, j.submit_attempts,
       j.completed_at - s.created_at as total_time, j.error
from rg_surveys s
left join rg_processing_jobs j on j.survey_id = s.id
order by s.created_at desc
limit 10;

-- Mga job na naka-stuck: hindi pa tapos at matagal nang walang galaw
select j.id, j.survey_id, j.status, j.provider_state, j.progress, j.updated_at, j.error
from rg_processing_jobs j
where j.status not in ('Needs review', 'Reviewed', 'Failed', 'Cancelled')
  and j.updated_at < now() - interval '15 minutes'
order by j.updated_at;

-- Pila ng mga trabaho (Kaggle dispatch, SMS, atbp.)
select kind, state, attempts, available_at, last_error
from rg_outbox
order by available_at desc
limit 20;


-- ---------- 3. Photos, classifier at Gemma 4 ----------

-- Bawat photo ng isang survey (palitan ang id), kasama ang classifier at ang Gemma 4 insight
select a.id, a.filename, a.state,
       a.classification ->> 'top' as classifier_top,
       a.classification -> 'probs' as classifier_scores,
       a.llm_insight ->> 'crop_stage' as gemma_crop_stage,
       a.exif_lat, a.exif_lng
from rg_assets a
where a.survey_id = '00000000-0000-0000-0000-000000000000'
order by a.created_at;

-- Desisyon ng specialist (Tama / Mali / Hindi sigurado) sa bawat photo
select r.job_id, r.source_asset_id, r.disease, r.decision, r.reason, r.reviewed_at
from rg_finding_reviews r
order by r.reviewed_at desc
limit 20;


-- ---------- 3b. Patubig at barayti laban sa nakumpirmang sakit ----------
-- Ilang photo ang kinumpirma ng specialist (Tama) sa bawat sakit, hinati ayon sa patubig at barayti.
-- Para makita kung may kaugnayan ang irrigated/rainfed o ang barayti sa BLB at Brown Spot.
select s.irrigation, coalesce(s.rice_variety, '(walang barayti)') as rice_variety, r.disease,
       count(*) filter (where r.decision = 'accepted') as confirmed,
       count(*) filter (where r.decision = 'rejected') as rejected,
       count(distinct s.id) as surveys
from rg_finding_reviews r
join rg_processing_jobs j on j.id = r.job_id
join rg_surveys s on s.id = j.survey_id
where s.archived_at is null
group by 1, 2, 3
order by 1, 2, 3;

-- Lahat ng survey na may patubig at barayti
select id, name, irrigation, rice_variety, crop_stage, created_at
from rg_surveys
where archived_at is null
order by created_at desc;


-- ---------- 4. Advisories at SMS ----------

-- Mga advisory (bulletin) at kung published na
select id, title, disease, severity, status, verification_status, published_at, place
from rg_bulletins
order by created_at desc
limit 10;

-- Mga magsasakang naka-register sa SMS
select id, name, phone, location, barangay_code, consent, verified, created_at
from rg_contacts
order by created_at desc;

-- Mga SMS na ipinadala o ipapadala, at ang status
select r.phone, r.status, r.attempts, r.error, r.accepted_at, r.delivered_at
from rg_recipients r
order by r.created_at desc
limit 20;


-- ---------- 5. Audit log ----------

-- Sino ang gumawa ng ano, pinakabago muna
select kind, entity_id, actor_id, detail, created_at
from rg_events
order by created_at desc
limit 20;


-- ---------- 6. Halimbawa ng pagbabago (SUBUKAN SA LOCAL LANG) ----------
-- Pansamantalang pagsubok ito. Para sa permanenteng pagbabago, gumawa ng migration:
--   supabase migration new <pangalan>     (tingnan ang docs/DEBUGGING_GUIDE.md, Bahagi 3D)

-- Magdagdag ng column
-- alter table public.rg_contacts add column if not exists notes text;

-- Magtanggal ng column
-- alter table public.rg_contacts drop column if exists notes;

-- Mag-edit ng isang row
-- update public.rg_contacts set name = 'Bagong Pangalan' where id = '00000000-0000-0000-0000-000000000000';

-- Ibalik ang local database sa simula (sa terminal, hindi dito):
--   supabase db reset
