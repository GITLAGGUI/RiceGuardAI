-- Install an auditable, official-source baseline for automatic editable drafts.
-- These records do not turn a model finding into a diagnosis, severity grade,
-- pesticide prescription, or fertilizer rate.
do $$
declare
  reviewer uuid;
begin
  select id into reviewer from public.profiles
    where role='admin' and is_active order by created_at asc limit 1;
  -- Bagong (local) database na wala pang admin: laktawan muna. Ang supabase/seed.sql ang gagawa ng local admin
  -- at patatakbuhin ulit ang file na ito (tingnan ang [db.seed] sa config.toml). Na-apply na ito sa production.
  if reviewer is null then raise notice 'No active administrator yet; advisory sources skipped'; return; end if;

  insert into public.rg_advisory_sources(
    id,disease,title,version,guidance,source_reference,reviewed_by,approved_at,active
  ) values
  (
    '01f92418-94a8-406c-90f9-6b61d0ec680e','BLB',
    'DA-PhilRice bacterial leaf blight field management',
    'philrice-blb-field-management-20260929-v1',
    jsonb_build_object(
      'summary','The reviewed image finding indicates possible BLB. Confirm characteristic leaf symptoms in the field before management decisions.',
      'recommended_actions',jsonb_build_array(
        'Inspect affected leaves in person and ask a local agricultural specialist to confirm the cause.',
        'If BLB is confirmed, review resistant varieties, transplanting injury, field sanitation, drainage, spacing, and nitrogen use with the specialist; avoid excessive nitrogen.'
      ),
      'limitations',jsonb_build_array('An image alone cannot confirm BLB, field-wide severity, or the appropriate treatment.')
    ),
    'https://www.philrice.gov.ph/philrice-warns-of-major-rice-pest-threats-in-early-2026/',
    reviewer,now(),true
  ),
  (
    '9fd22d47-dcf1-4b1a-bf93-b0954cebcad0','Brown Spot',
    'DA-PhilRice brown spot monitoring and management',
    'philrice-brownspot-rainy-season-20260929-v1',
    jsonb_build_object(
      'summary','The reviewed image finding indicates possible Brown Spot. Confirm leaf symptoms and consider other causes of brown discoloration during field inspection.',
      'recommended_actions',jsonb_build_array(
        'Inspect affected leaves with a local agricultural specialist before treating the field.',
        'If Brown Spot is confirmed, review seed quality, water depth, balanced fertility, and crop-stage-appropriate management with the specialist; do not infer a fertilizer rate from the image.'
      ),
      'limitations',jsonb_build_array('Brown leaf marks may have other causes; the current mask does not measure lesion-area severity or justify an automatic fungicide recommendation.')
    ),
    'https://www.philrice.gov.ph/philrice-alerts-rice-farmers-of-increased-pest-threats-during-rainy-season/',
    reviewer,now(),true
  ),
  (
    'fa512b82-4ce3-4423-a5bd-85b116a66908','Brown Spot',
    'DA-PhilRice nutrient diagnosis before fertilizer decisions',
    'philrice-nutrient-diagnosis-20260929-v1',
    jsonb_build_object(
      'summary','Brown leaf symptoms do not by themselves prove nutrient deficiency. Nutrient decisions should use field observations and diagnostic tools.',
      'recommended_actions',jsonb_build_array(
        'Before changing fertilizer, check soil or plant nutrient status using soil analysis, MOET, LCC, or Rice Crop Manager with an agricultural specialist.',
        'Use the correct nutrient element, amount, and timing; avoid both deficient and excessive fertilization.'
      ),
      'limitations',jsonb_build_array('The image model cannot identify a missing nutrient or calculate a fertilizer formulation or rate.')
    ),
    'https://www.philrice.gov.ph/sa-paglalagay-ng-pataba-siguraduhing-tama-ang-uri-dami-at-panahon-ng-paglalagay/',
    reviewer,now()-interval '1 second',true
  )
  on conflict(disease,version) do update set
    title=excluded.title,guidance=excluded.guidance,
    source_reference=excluded.source_reference,active=true;

  insert into public.rg_events(kind,entity_id,actor_id,detail)
    values('official-advisory-baseline-installed','riceguard-advisory-sources',reviewer,
      jsonb_build_object('versions',jsonb_build_array(
        'philrice-blb-field-management-20260929-v1',
        'philrice-brownspot-rainy-season-20260929-v1',
        'philrice-nutrient-diagnosis-20260929-v1'
      ),'review_basis','official DA-PhilRice source baseline for editable staff-reviewed drafts'));
end $$;
