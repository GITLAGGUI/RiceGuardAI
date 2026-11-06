-- Brown Spot masks are drawn bright green (0, 230, 118) instead of red. New worker workflow pin.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.rg_claim_dispatch_v2(text,integer)'::regprocedure);
  definition := replace(definition, '2fd7ab341e6aebcff9b2da56d00626134b52244522384a65fdd81f7e8520ca0a', '950904fed895eef61e95d76407541d6fdc89ad9090674b97f6d10bd3c80cb55d');
  execute definition;
  definition := pg_get_functiondef('public.rg_complete_pinned_job(uuid,bigint,jsonb)'::regprocedure);
  if position('950904fed895eef61e95d76407541d6fdc89ad9090674b97f6d10bd3c80cb55d' in definition) = 0 then
    definition := replace(definition, '''2fd7ab341e6aebcff9b2da56d00626134b52244522384a65fdd81f7e8520ca0a'',', '''950904fed895eef61e95d76407541d6fdc89ad9090674b97f6d10bd3c80cb55d'',
      ''2fd7ab341e6aebcff9b2da56d00626134b52244522384a65fdd81f7e8520ca0a'',');
    execute definition;
  end if;
end $$;
