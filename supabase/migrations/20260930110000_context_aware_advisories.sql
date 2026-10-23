-- Capture reviewed agronomic context separately from model findings so advice
-- can change with the field situation without asking the disease models to
-- infer flooding, crop stage, nutrient stress, or pests.
alter table public.rg_surveys
  add column if not exists crop_stage text not null default 'unknown',
  add column if not exists field_conditions text[] not null default '{}';

alter table public.rg_surveys drop constraint if exists rg_surveys_crop_stage_check;
alter table public.rg_surveys add constraint rg_surveys_crop_stage_check
  check(crop_stage in ('unknown','seedling','vegetative','reproductive','ripening','post_harvest'));
alter table public.rg_surveys drop constraint if exists rg_surveys_field_conditions_check;
alter table public.rg_surveys add constraint rg_surveys_field_conditions_check
  check(field_conditions <@ array[
    'standing_water','lodging','dry_or_cracked_soil','nutrient_stress_suspected','pest_damage_suspected'
  ]::text[]);

do $$
declare reviewer uuid;
begin
  select id into reviewer from public.profiles
    where role='admin' and is_active order by created_at asc limit 1;
  if reviewer is null then raise exception 'An active administrator is required to install advisory sources'; end if;

  insert into public.rg_advisory_sources(
    id,disease,title,version,guidance,source_reference,reviewed_by,approved_at,active
  ) values
  (
    '17876a18-39f3-4cb6-b02a-3d2cbf5f9be1','BLB',
    'DA-PhilRice drainage and excess-water field response',
    'philrice-field-water-context-20260930-blb-v1',
    jsonb_build_object(
      'applies_when',jsonb_build_array('standing_water'),
      'summary','Standing water is a separate reviewed field condition and is not diagnosed by the BLB model.',
      'recommended_actions',jsonb_build_array(
        'Because standing water or possible flooding was recorded, verify water depth, duration, crop stage, and whether plants were partly or fully submerged before deciding on field action.',
        'If excess water or prolonged submergence is confirmed, inspect and safely clear or repair drainage channels and coordinate recovery decisions with the municipal agriculture office or a rice specialist.'
      ),
      'limitations',jsonb_build_array('A photograph and nearby weather cannot determine flood duration, water depth, root condition, or crop recovery.')
    ),
    'https://www.philrice.gov.ph/basics-land-preparation/',reviewer,now(),true
  ),
  (
    'b8c07a0e-0f9e-48f6-8d42-28a952d80bf4','Brown Spot',
    'DA-PhilRice drainage and excess-water field response',
    'philrice-field-water-context-20260930-brownspot-v1',
    jsonb_build_object(
      'applies_when',jsonb_build_array('standing_water'),
      'summary','Standing water is a separate reviewed field condition and is not diagnosed by the Brown Spot model.',
      'recommended_actions',jsonb_build_array(
        'Because standing water or possible flooding was recorded, verify water depth, duration, crop stage, and whether plants were partly or fully submerged before deciding on field action.',
        'If excess water or prolonged submergence is confirmed, inspect and safely clear or repair drainage channels and coordinate recovery decisions with the municipal agriculture office or a rice specialist.'
      ),
      'limitations',jsonb_build_array('A photograph and nearby weather cannot determine flood duration, water depth, root condition, or crop recovery.')
    ),
    'https://www.philrice.gov.ph/basics-land-preparation/',reviewer,now(),true
  )
  on conflict(disease,version) do update set
    title=excluded.title,guidance=excluded.guidance,source_reference=excluded.source_reference,active=true;
end $$;
