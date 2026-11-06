# Patubig, barayti ng palay, berdeng Brown Spot mask at clip inputs

Petsa: 2026-11-06 · Commit (local lang): "Record irrigation and rice variety per survey; green Brown Spot masks; clip inputs without leading zeros"

> **Nasa localhost lang ito.** Naka-commit sa local `main` ng `website_repo` at naka-apply sa local Docker database.
> Hindi pa ito naka-push sa GitHub at hindi pa naka-deploy sa riceguardai.dev. Tingnan ang Bahagi 6 para sa production.

---

## 1. Ano ang idinagdag

| Feature | Para saan |
| --- | --- |
| **Patubig** (`irrigation`): Hindi alam / May patubig (irrigated) / Umaasa sa ulan (rainfed) | Malaman kung may kaugnayan ang uri ng patubig sa BLB at Brown Spot |
| **Barayti ng palay** (`rice_variety`): malayang text na may mga mungkahi (NSIC Rc 222, PSB Rc 18, …) | Malaman kung may barayting mas tinatamaan ng sakit |
| **Berdeng Brown Spot mask** | Ang mask at ang kulay sa legend ay bright green na (`#00E676`, RGB `0, 230, 118`) sa halip na pula. Dilaw pa rin ang BLB. |
| **Clip inputs** | Kapag nag-type ng `1`, `1` ang lalabas at hindi `01` |

---

## 2. Database

### Migration: `supabase/migrations/20261106090000_survey_irrigation_variety.sql`

```sql
alter table public.rg_surveys
  add column if not exists irrigation text not null default 'unknown',   -- unknown | irrigated | rainfed
  add column if not exists rice_variety text;                            -- hanggang 120 characters
```

- May `check` constraint: `irrigation` ay `unknown`, `irrigated` o `rainfed` lang; `rice_variety` ay 1–120 characters o `null`.
- Bagong bersyon ng function na **`rg_update_survey(p_survey, p_actor, p_name, p_note, p_irrigation, p_rice_variety)`**.
  Nire-record din nito sa `rg_events` (audit log) ang bagong patubig at barayti. Nandoon pa rin ang lumang
  4-argument na bersyon.

### Migration: `supabase/migrations/20261106091000_worker_green_brown_spot_pin.sql`

Bagong workflow pin (`950904fe…`) dahil nagbago ang kulay sa GPU worker (Bahagi 4). Sa production lang ito may
epekto; walang Kaggle sa localhost.

### Para makita sa database

Buksan ang `supabase/debug-queries.sql`, Bahagi **3b**:
- bilang ng nakumpirmang sakit (Tama / Mali) ayon sa patubig at barayti
- listahan ng survey na may patubig at barayti

O sa Database Client / Supabase Studio: table `rg_surveys`, columns `irrigation` at `rice_variety`.

---

## 3. Server (edge functions)

| File | Binago |
| --- | --- |
| `supabase/functions/field-operations/index.ts` | `create-survey`: tumatanggap at sinusuri ang `irrigation` at `rice_variety` bago i-save. `update-survey`: ipinapasa ang dalawa sa bagong `rg_update_survey`. Snapshot: kasama ang `irrigation,rice_variety` sa listahan ng survey. |
| `supabase/functions/auto-pipeline/index.ts` | Kasama ang patubig at barayti sa `facts` na binabasa ng Gemma 4 kapag sumusulat ng advisory |
| `supabase/functions/_shared/ollamaAdvisory.ts` | Idinagdag ang `irrigation` at `rice_variety` sa type na `AdvisoryFacts` |

---

## 4. GPU worker (kulay ng mask)

| File | Binago |
| --- | --- |
| `workers/aws/inference_core.py` | `COLORS = {"BLB": (255, 212, 0), "Brown Spot": (0, 230, 118)}`. Dito "ipinipinta" ang mask sa larawan. |
| `workers/aws/test_inference_overlay.py` | Inaasahang kulay sa test ay berde na. Pumasa: `python -m pytest workers/aws/test_inference_overlay.py`. |
| `supabase/functions/_shared/pinnedResult.ts` | Bagong `PINNED_KAGGLE_WORKFLOW_SHA256`; ang dati ay nasa `PREVIOUS_LESION_WORKFLOWS` para tanggap pa rin ang mga lumang resulta |

> **Mahalaga:** ang mga dating na-process na larawan ay mananatiling pula ang Brown Spot mask, dahil nakaimbak na
> ang mga larawang iyon. Ang mga **bagong** upload lang ang magiging berde (kapag na-deploy na sa production).
>
> Paalala sa kulay: berde rin ang dahon ng palay, kaya mas mahirap makita ang berdeng mask kaysa pula. May
> madilim na outline pa rin ang bawat mask para makita ang gilid.

---

## 5. Frontend

| File | Binago |
| --- | --- |
| `frontend/src/operations/domain.ts` | `Survey.irrigation`, `Survey.rice_variety`; `IRRIGATION_LABEL` (mga label sa Tagalog) at `COMMON_RICE_VARIETIES` (mga mungkahing barayti, puwedeng dagdagan) |
| `frontend/src/operations/Upload.tsx` | Dalawang bagong field sa ilalim ng "Yugto ng palay": **Patubig ng bukid** (dropdown) at **Barayti ng palay** (text na may suggestions). Kasama sa ipinapadala sa `create-survey`. Ang `selectNumber` at `cleanNumber` sa itaas ng file ang nag-aayos ng `01` sa clip inputs. |
| `frontend/src/operations/Admin.tsx` | `SurveyActions`: may Patubig at Barayti na sa "I-edit ang survey" dialog. `SurveysPage`: ipinapakita sa ilalim ng lugar, hal. "Poblacion 1, Santa Maria · Irrigated · PSB Rc 18". |
| `frontend/src/operations/WorkspaceUi.tsx` | Ang `EditDialog` ay puwede nang magkaroon ng dropdown (`options`) at suggestions (`list`) |
| `frontend/src/operations/DiseasePhoto.tsx` | `DISEASE_COLORS["Brown Spot"] = "#00E676"` (kulay sa legend at sa mga tuldok) |
| `frontend/src/operations/bulletin.css` | `--rg3-spot: #00e676;` |
| `frontend/src/operations/landing/hero-v5.css` | Kulay ng Brown Spot sa hero ng landing page |

Para magdagdag ng barayti sa mga suggestion: i-edit ang `COMMON_RICE_VARIETIES` sa `domain.ts`.

---

## 6. Paano ito sinubukan (localhost)

1. Na-apply ang dalawang migration sa local Docker database at naitala sa `supabase_migrations.schema_migrations`.
2. `update-survey` gamit ang local admin: nag-save ng `irrigated` + `PSB Rc 18`, at naitala sa `rg_events`.
   Tinanggihan ang maling value (`swamp`).
3. Sa `http://localhost:5173/admin/surveys`: lumabas ang "Irrigated · PSB Rc 18" sa table; sa edit dialog,
   napalitan ng `rainfed` at na-save sa database.
4. Sa `http://localhost:5173/admin/surveys/new`: lumabas ang Patubig (3 pagpipilian) at Barayti (10 suggestions).
5. `npm run typecheck`, `vite build` at ang overlay test ay pumasa.

**Hindi nasubukan sa local:**
- Ang aktuwal na pag-upload hanggang dulo (walang Kaggle GPU sa localhost).
- Ang berdeng mask sa totoong larawan (gawa ito ng GPU worker; ang test lang ang nagpatunay ng kulay).

### Kapag ide-deploy na sa production

Sabihin lang sa Claude, o gawin nang sabay-sabay (dahil may bagong workflow pin):
1. I-push sa GitHub `main` (magre-redeploy ang Vercel).
2. I-apply ang dalawang migration sa production database.
3. I-deploy ang `field-operations`, `auto-pipeline`, `worker-callback` at `job-dispatcher`.
