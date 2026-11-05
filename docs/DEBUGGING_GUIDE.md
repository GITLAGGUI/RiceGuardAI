# RiceGuardAI Debugging Guide (Taglish)

Gabay ito para sa team kapag may babaguhin, idadagdag o aayusin sa website, sa database (PostgreSQL) o sa automation.
Basahin muna ang **Bahagi 1** at **Bahagi 3**. Iyon ang pinakamadalas ninyong kailanganin.

> **Pinakaimportanteng paalala:** ang `main` branch sa GitHub ay **awtomatikong nade-deploy sa riceguardai.dev**.
> Huwag mag-push ng hindi pa natetest sa `main`. Gumawa ng sariling branch (Bahagi 7).

---

## 0. Mapa ng buong system

```text
Browser (React + Vite, frontend/)
   │  supabase-js
   ▼
Supabase
   ├─ Auth (login ng staff)
   ├─ PostgreSQL database (mga table na rg_*, RLS, RPC functions)      ← supabase/migrations/*.sql
   ├─ Edge Functions (Deno/TypeScript)                                  ← supabase/functions/<pangalan>/index.ts
   │     field-operations  = halos lahat ng ginagawa ng staff page (upload, edit, delete, snapshot)
   │     job-dispatcher    = nagpapadala ng job sa Kaggle GPU
   │     worker-callback   = tumatanggap ng resulta galing Kaggle
   │     auto-pipeline     = severity → advisory (Gemma 4) → bulletin → SMS
   │     send-sms / sms-webhook = SMS gateway (Android phone)
   └─ pg_cron (mga naka-schedule na trabaho)
Kaggle GPU (workers/kaggle/*.py)  ← BLB + Brown Spot model + photo classifier
Vercel (riceguardai.dev)           ← frontend at api/kaggle.py
```

| Folder | Laman | Kailan i-e-edit |
| --- | --- | --- |
| `frontend/src/operations/` | Halos lahat ng page (public at staff) | UI, kulay, button, bagong feature |
| `frontend/src/operations/landing/` | Landing page (`/`) | Hero, film, sections ng homepage |
| `frontend/src/app/router.tsx` | Listahan ng URL → page | Bagong page / URL |
| `supabase/migrations/` | Lahat ng pagbabago sa database | Bagong table/column/function |
| `supabase/functions/` | Server code (edge functions) | Logic na hindi puwedeng gawin sa browser |
| `workers/kaggle/` | GPU worker | **Huwag galawin** maliban kung alam ninyo ang "workflow pin" (Bahagi 6) |

> `frontend/src/pages/` at `router.legacy.tsx` ay **luma at hindi na ginagamit** ng live na website.
> Ang mga file na may `-LAPTOP-RUI40DF1` sa pangalan ay **OneDrive conflict copy**: huwag i-edit.

---

## 1. Paano mabilis mahanap ang file na kailangang i-debug

Tama kayo: hindi sapat ang F12/Inspect dahil React ito. Hindi HTML file ang makikita ninyo, kundi ang ginawang HTML ng React.
Ito ang mga paraan, mula sa pinakamabilis:

### 1A. Alt + Shift + Click (pinakamabilis) ⭐

Naka-install na ang **code-inspector-plugin** (sa `frontend/vite.config.ts`). Gumagana lang ito sa `npm run dev`.

1. Patakbuhin ang `npm run dev` (o `npm run dev:local`) at buksan ang `http://localhost:5173`.
2. **Pindutin nang matagal ang `Alt` + `Shift`** at itapat ang mouse sa kahit anong bahagi ng page.
   May lalabas na kahon na may pangalan ng file at linya.
3. **I-click.** Bubukas sa VS Code ang mismong file, sa mismong linya ng button/text/section na iyon.

Kapag hindi bumukas ang VS Code: dapat naka-install ang `code` command
(VS Code → `Ctrl+Shift+P` → "Shell Command: Install 'code' command in PATH").

### 1B. Hanapin ang text na nakikita ninyo (Ctrl + Shift + F)

Halimbawa, gusto ninyong baguhin ang button na "Upload at suriin":

1. Sa VS Code, pindutin ang `Ctrl + Shift + F`.
2. I-type ang eksaktong text: `Upload at suriin`.
3. Sa "files to include", ilagay ang `frontend/src` para hindi kasama ang node_modules.

Gumagana ito sa lahat ng text na nakasulat sa code (title, label, button, error message).

### 1C. Para sa CSS: Inspect → class name → hanapin sa .css

1. Right-click sa element → **Inspect**.
2. Tingnan ang `class="..."`, hal. `class="lp-film-frame"` o `class="ws-sidebar"`.
3. Sa VS Code, `Ctrl + Shift + F` → hanapin ang `.lp-film-frame` (may tuldok) sa `frontend/src`.
4. Sa Inspect, sa kanan (**Styles** panel), nakasulat din kung aling CSS rule ang nananaig.
   Kapag naka-guhit (strikethrough), may ibang rule na nananaig dito.

Prefix ng class → saang CSS file:

| Prefix ng class | CSS file | Saan makikita |
| --- | --- | --- |
| `lp-` | `landing/landing.css`, `landing/landing-v4.css`, `landing/hero-v5.css` | Landing page (`/`) |
| `ws-`, `rg-ops` | `operations/workspace.css`, `operations/operations.css` | Staff workspace (`/admin/...`) |
| `rg-public`, `bulletin`, `rg-feed` | `operations/bulletin.css`, `bulletin-feed.css`, `operations.css` | Field advisories, public pages |
| `rg-fit` | `operations/fit-pages.css` | Map, registration, SMS pages |

### 1D. Mula sa URL → file

Tingnan ang `frontend/src/app/router.tsx`. Doon nakalista kung anong component ang lumalabas sa bawat URL.

| URL | File |
| --- | --- |
| `/` | `operations/landing/HomeLanding.tsx` |
| `/bulletin`, `/advisories/...` | `operations/Public.tsx`, `operations/BulletinPost.tsx` |
| `/map` | `operations/Public.tsx` + `operations/Map.tsx` |
| `/register`, `/preferences` | `operations/Registration.tsx` |
| `/login` | `pages/public/Login.tsx` |
| `/admin/overview`, `/admin/surveys`, `/admin/map`, `/admin/advisories`, `/admin/farmers`, `/admin/settings` | `operations/Admin.tsx` (hanapin ang `OverviewPage`, `SurveysPage`, `MapPage`, `AdvisoryDesk`, `FarmersPage`, `SettingsPage`) |
| `/admin/surveys/new` (Upload at suriin) | `operations/Upload.tsx` |
| `/admin/review` (Verify findings) | `operations/VerifyFindings.tsx` |
| `/demo/...` (dev lang, walang login, pekeng data) | `operations/Admin.tsx` + `operations/devFixture.ts` |

### 1E. Mga comment na "GABAY"

Sa itaas ng mga pangunahing file ay may comment na nagsisimula sa `GABAY:`. Sinasabi nito kung ano ang laman ng file
at kung saan pupunta para sa kaugnay na bagay. Hanapin ang lahat gamit ang `Ctrl + Shift + F` → `GABAY:`.

### 1F. React DevTools (optional)

I-install ang browser extension na **React Developer Tools**. Sa F12 may lalabas na tab na **Components**.
Makikita ang pangalan ng component (hal. `VerifyFindings`) at ang data nito (props/state).

---

## 2. Patakbuhin ang website sa localhost

Kailangan: Node.js, Docker Desktop (para sa local database), Supabase CLI, VS Code.

```bash
cd website_repo/frontend
npm install
```

May dalawang paraan ng pagpapatakbo:

| Command | Database na gamit | Kailan gamitin |
| --- | --- | --- |
| `npm run dev` | **Production** (ang totoong riceguardai.dev database) | Pagtingin ng itsura gamit ang totoong data. **Mag-ingat:** ang edit/delete dito ay totoo. |
| `npm run dev:local` | **Local Docker database** | Debugging, pagsubok ng query, pagdagdag/pagtanggal ng column. Ligtas sirain. |

Parehong bubukas sa `http://localhost:5173`. Para sa itsura ng staff pages nang walang login, buksan ang
`http://localhost:5173/demo`.

### Login sa local (walang MFA)

Kapag `npm run dev:local`, may handang admin account sa local database (ginawa ng `supabase/seed.sql`):

| Email | Password |
| --- | --- |
| `local-admin@riceguard.test` | `123456` |

Hindi na ito hihingi ng authenticator app (MFA). Gumagana ito **sa local lang**. Tatlong kondisyon ang kailangan at
wala ang mga ito sa production: dev mode, `localhost` na database URL at `VITE_LOCAL_SKIP_MFA=true` (frontend), at
`LOCAL_SKIP_MFA=true` sa `supabase/functions/.env` (server). Kusang isinusulat ng `npm run dev:local` ang dalawang
flag na ito. Kapag unang beses itong idinagdag, i-restart ang Supabase: `supabase stop` tapos `supabase start`.

> Gamitin ang port **5173** (ang default ng `npm run dev:local`). Ang local server ay tumatanggap lang ng request galing
> sa `http://localhost:5173`. Kapag ibang port, "Origin not allowed" ang error.

### Kahit walang internet (offline)

Gumagana nang offline ang local database, ang login at ang website **pagkatapos ng unang `supabase start`**
(kailangan ng internet sa unang beses lang, para ma-download ang Docker images). Ang mga bahaging laging
nangangailangan ng internet:

- Map tiles (OpenStreetMap / satellite): blangko ang mapa kapag offline, pero gumagana pa rin ang pins at data.
- Gemma 4 photo check, AI advisory, weather at ang Kaggle GPU job: online services ang mga ito.
- Pagpapadala ng totoong SMS.

Para sa debugging ng UI, CSS, mga query at CRUD (add/edit/delete), sapat ang offline.

---

## 3. Local PostgreSQL sa Docker

Tama kayo: tumatakbo sa Docker ang local database. Ginagamit ng **Supabase CLI** ang Docker para patakbuhin ang buong
Supabase sa laptop: PostgreSQL, Auth, Storage, Studio (web UI) at iba pa. Hindi na kailangang gumawa ng sariling
`docker run postgres`, dahil ang `supabase start` na ang gagawa ng container at magpapatakbo ng **lahat ng migration** sa
`supabase/migrations/`, kaya pareho ang structure nito sa production.

### 3A. Pag-start

1. Buksan ang **Docker Desktop** at hintaying "Engine running".
2. Sa terminal:

   ```bash
   cd website_repo
   supabase start
   ```

   Matagal ang unang beses (nagda-download ng mga image). Sa susunod, mga 20–40 segundo na lang.
3. Pagkatapos, `npm run dev:local` sa `frontend/`.

| Ano | Address |
| --- | --- |
| Supabase Studio (web UI ng database) | http://127.0.0.1:54323 |
| API (ginagamit ng frontend) | http://127.0.0.1:54321 |
| PostgreSQL (para sa psql, DBeaver, pgAdmin) | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

Para patayin: `supabase stop` (nananatili ang data). Para burahin at gawing bago ang local database (patatakbuhin ulit
ang lahat ng migration at `supabase/seed.sql`, kasama ang local admin): `supabase db reset`.

> **Huwag gamitin ang ▶ Start button sa Docker Desktop** para sa `supabase_*` containers. Lalabas ang error na
> "no container found for project". Laging `supabase start` sa terminal (sa `website_repo`).

Kapag pumalya ang `supabase start` dahil may container na "not ready: unhealthy" o "not ready: starting", patakbuhin ulit:
`supabase stop` tapos `supabase start`. Kung ayaw pa rin, `supabase stop --no-backup` (buburahin ang local data) tapos
`supabase start`. Naka-off ang analytics sa `supabase/config.toml` dahil madalas itong pumapalya sa Windows.

> Bagong database ito: walang laman ang `rg_surveys`, `rg_assets` at iba pa. May laman na ang Region II locations
> (`rg_locations`, `rg_barangay_boundaries`), ang advisory sources at tatlong sample na magsasaka. Para sa data,
> mag-upload sa local o mag-insert gamit ang SQL Editor.

### 3B. Saan magta-type ng SQL query

- **Studio:** http://127.0.0.1:54323 → **SQL Editor** → i-type ang query → **Run**. Sa **Table Editor** makikita ang laman ng bawat table.
- **psql sa loob ng Docker container** (walang kailangang i-install):

  ```bash
  docker exec -it supabase_db_pekowozxnyyeskymjxyx psql -U postgres
  ```

  Sa loob: `\dt public.*` (lahat ng table), `\d public.rg_surveys` (columns ng isang table), `\q` (exit).
- **DBeaver / pgAdmin:** host `127.0.0.1`, port `54322`, user `postgres`, password `postgres`, database `postgres`.

### 3B-2. PostgreSQL extension sa VS Code (inirerekomenda)

1. Sa VS Code, `Ctrl + Shift + X` → hanapin ang **PostgreSQL** (publisher: **Microsoft**) → **Install**.
2. Sa kaliwa, i-click ang icon ng elephant → **Add Connection**:

   | Field | Value |
   | --- | --- |
   | Server / Host | `127.0.0.1` |
   | Port | `54322` |
   | Database | `postgres` |
   | User | `postgres` |
   | Password | `postgres` |

3. Buksan ang [`supabase/debug-queries.sql`](../supabase/debug-queries.sql). I-select ang isang query at i-run
   gamit ang Run button (▷) sa itaas ng editor. Lalabas ang resulta sa ibaba.
4. Sa connection tree, makikita ang bawat table (`public` → Tables) at bawat function (`public` → Functions).
   I-right-click ang table → **Select Top 1000** para makita ang laman.

> Kailangang naka-`supabase start` ang local database. Huwag ilagay dito ang production database. Ang
> production ay para lang sa isang tao sa team, gamit ang Supabase Dashboard.

### 3B-3. Saan nakasulat ang mga query sa code

Tatlong lugar ang may SQL o query:

| Lugar | Laman | Kailan i-e-edit |
| --- | --- | --- |
| `supabase/migrations/*.sql` | **Lahat ng structure**: `create table`, column, RLS policy, at ang 40 database function (`rg_update_contact`, `rg_delete_contact`, `rg_verify_findings`, …) | Bagong column/table/function. Huwag i-edit ang luma; gumawa ng bagong migration (3D). |
| `supabase/functions/*/index.ts` | Mga query na tumatakbo sa server: `db.from("rg_surveys").select(...)`, `.update(...)`, `.insert(...)`, at tawag sa function: `db.rpc("rg_update_contact", {...})` | Pagbago ng logic ng isang action (hal. edit/delete ng contact sa `field-operations`) |
| `supabase/debug-queries.sql` | Handang query para sa debugging (hindi ginagamit ng website) | Malayang baguhin |

Ang browser (`frontend/`) ay **hindi** direktang sumusulat sa database. Tumatawag ito sa edge function na
`field-operations`, na siyang nagpapatakbo ng query.

**Paano hanapin ang query ng isang feature:**

1. Hanapin ang action sa frontend. Halimbawa, ang Edit ng magsasaka ay tumatawag ng `"update-contact"`.
2. Sa VS Code, `Ctrl + Shift + F` → `action === "update-contact"` → dadalhin ka sa `supabase/functions/field-operations/index.ts`.
3. Doon makikita ang `db.rpc("rg_update_contact", ...)`. Ang database function na iyon ay nasa migration:
   `Ctrl + Shift + F` → `function public.rg_update_contact`. Kung marami ang lumabas, ang **pinakabagong file**
   (pinakamalaking numero sa pangalan) ang aktibo.
4. Mas mabilis: patakbuhin sa `debug-queries.sql` ang query na "Ang kasalukuyang code ng isang function".
   Ipapakita nito ang aktibong bersyon mula mismo sa database.

### 3C. Mga pangunahing table

| Table | Laman |
| --- | --- |
| `rg_surveys` | Bawat upload (batch ng photo/video) at ang status nito |
| `rg_assets` | Bawat photo/video sa loob ng survey, kasama ang `classification` (classifier) at `llm_insight` (Gemma 4) |
| `rg_processing_jobs` | Kaggle GPU job ng bawat survey (status, progress, error) |
| `rg_finding_reviews` | Desisyon ng specialist (Tama / Mali / Hindi sigurado) |
| `rg_bulletins`, `rg_public_posts` | Mga advisory na nakikita sa public |
| `rg_contacts`, `rg_recipients` | Mga magsasakang naka-register sa SMS |
| `rg_outbox` | Pila ng SMS na ipapadala |
| `rg_events` | Audit log (sino ang gumawa ng ano) |

Halimbawang query:

```sql
-- 10 pinakabagong survey at ang status ng GPU job nila
select s.id, s.status, s.created_at, j.status as job_status, j.progress, j.error
from rg_surveys s
left join rg_processing_jobs j on j.survey_id = s.id
order by s.created_at desc
limit 10;

-- Lahat ng column ng isang table
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'rg_assets' order by ordinal_position;
```

### 3D. Pagdagdag o pagtanggal ng column / table (tamang paraan)

**Huwag i-edit ang lumang migration file.** Na-apply na ang mga iyon sa production. Gumawa ng bago:

```bash
cd website_repo
supabase migration new add_notes_to_contacts
```

Gagawa ito ng file na `supabase/migrations/<timestamp>_add_notes_to_contacts.sql`. Isulat ang SQL doon, hal.:

```sql
-- Dagdag: notes ng staff para sa bawat contact
alter table public.rg_contacts add column if not exists notes text;
```

Pagtanggal: `alter table public.rg_contacts drop column if exists notes;`

Pagkatapos:

1. `supabase db reset` → subukan sa local database.
2. Idagdag ang field sa type sa `frontend/src/operations/domain.ts` (hal. `notes?: string | null`).
3. Kung kailangang basahin/isulat ito ng server, i-update ang `supabase/functions/field-operations/index.ts`
   (hanapin ang `action === "update-contact"` o ang katulad na action).
4. Kapag gumagana na sa local, saka lang i-apply sa production gamit ang `supabase db push` (isang tao lang sa team ang gagawa nito).

> **RLS (Row Level Security):** read-only ang mga table para sa browser. Lahat ng pagsulat (insert/update/delete) ay
> dumadaan sa edge function na `field-operations`, na tumitingin kung admin at naka-MFA ang user. Kaya kapag
> "permission denied" ang error sa browser, hindi bug iyon: idagdag ang action sa field-operations.

---

## 4. Mga karaniwang babaguhin: saan pupunta

| Gusto kong... | Pumunta sa |
| --- | --- |
| Palitan ang kulay ng background ng staff pages | `frontend/src/operations/workspace.css` (hanapin ang `background`) |
| Palitan ang pangunahing kulay (berde, text) sa lahat | Mga variable sa itaas ng `operations.css` (`--rg-ink`, `--rg-bg`, `--rg-green`) |
| Palitan ang kulay/laki ng hero o film sa landing | `frontend/src/operations/landing/hero-v5.css` |
| Palitan ang text ng landing | `frontend/src/operations/landing/HomeLanding.tsx` |
| Palitan ang film | `FILM_SRC` sa `HomeLanding.tsx` + file sa `frontend/public/video/` |
| Magdagdag ng button sa isang staff page | Hanapin ang page sa table ng 1D, tapos `Alt+Shift+Click` sa malapit na button |
| Magdagdag ng bagong page sa sidebar | `Admin.tsx` (sidebar sa `OperationsShell`) + `router.tsx` (listahang `operations`) |
| Baguhin ang "Sigurado ka ba?" dialog | `frontend/src/operations/WorkspaceUi.tsx` (`ConfirmDialog`) |
| Baguhin ang mapa (pins, kulay) | `frontend/src/operations/Map.tsx` |
| Baguhin ang laman ng SMS | `supabase/functions/auto-pipeline/index.ts` at `supabase/functions/send-sms/index.ts` |
| Baguhin ang prompt ng Gemma 4 | `supabase/functions/_shared/photoInsight.ts` (photo check) at `auto-pipeline` (advisory) |
| Larawan, logo, mascot | `frontend/public/images/` |

Tip sa CSS: kapag binago ninyo ang .css habang tumatakbo ang `npm run dev`, magbabago agad ang page nang hindi nire-refresh.
Kapag walang nangyari, baka may mas huling CSS rule na nananaig (tingnan ang Styles panel sa Inspect, Bahagi 1C).

---

## 5. Debugging ng errors

| Sintomas | Saan titingin |
| --- | --- |
| Blangko o puting page | F12 → **Console** (pulang error). Terminal ng `npm run dev`. |
| Hindi lumalabas ang data | F12 → **Network** → hanapin ang `field-operations` o `rest/v1` → tingnan ang **Response**. |
| `Unknown operation` | Wala pa sa deployed na `field-operations` ang action. I-deploy ang function. |
| `permission denied for table` | RLS. Dapat dumaan sa `field-operations` (Bahagi 3D). |
| Error sa TypeScript (pulang guhit) | `npm run typecheck` sa `frontend/` |
| `npm run build` pumapalya sa file na may `-LAPTOP-RUI40DF1` | OneDrive conflict copy iyon. Ilipat palabas ng `frontend/src` (hal. sa isang backup folder). |
| `Origin not allowed` | Gamitin ang `http://localhost:5173` (Bahagi 2). |
| `Database error querying schema` sa login | Burahin at gawing bago: `supabase db reset`. |
| Gusto ninyong makita ang value ng variable | Maglagay ng `console.log("survey", survey)` at tingnan sa Console. Tanggalin pagkatapos. |
| Error sa edge function | Supabase Dashboard → Edge Functions → Logs. Sa local: `supabase functions serve` (kailangan ng secrets). |
| Matagal o naka-stuck ang upload | Table `rg_processing_jobs`: tingnan ang `status`, `progress`, `error`. |

Bago mag-commit, patakbuhin sa `frontend/`:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

---

## 6. Mga bawal galawin nang basta-basta

- **`workers/kaggle/*.py`**: may SHA-256 "workflow pin" ang mga file na ito (`supabase/functions/_shared/pinnedResult.ts`).
  Kahit isang comment o espasyo lang ang mabago, tatanggihan ng server ang resulta ng GPU. Kapag kailangang baguhin,
  sabay na i-update ang pin, ang migration ng pin at ang deploy.
- **Lumang migration files**: gumawa ng bago (Bahagi 3D).
- **Secrets at keys**: huwag ilagay sa code o sa `VITE_` variable. Nasa Supabase secrets at Vercel env ang mga ito.
- **Model weights at datasets**: hindi kasama sa git. Nasa README ("Models used") kung nasaan sila.

---

## 7. Git: ligtas na paraan ng pagbabago

```bash
git switch -c fix/kulay-ng-sidebar
```

Gawin ang pagbabago, i-test sa `npm run dev:local`, tapos:

```bash
git add frontend/src/operations/workspace.css
git commit -m "Palitan ang kulay ng sidebar"
git push -u origin fix/kulay-ng-sidebar
```

Gumawa ng Pull Request sa GitHub papunta sa `main`. Kapag na-merge sa `main`, awtomatikong made-deploy sa riceguardai.dev.
Protektado ang `main`: hindi puwedeng i-force-push o burahin.
