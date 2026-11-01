-- Gemma 4's pre-upload look at each photo (crop stage, likely diseases/pests/nutrient conditions,
-- photo quality). Advisory context only; the pinned specialists still decide measured findings.
alter table public.rg_assets add column if not exists llm_insight jsonb
  check (llm_insight is null or (jsonb_typeof(llm_insight)='object' and jsonb_typeof(llm_insight->'conditions')='array'));
