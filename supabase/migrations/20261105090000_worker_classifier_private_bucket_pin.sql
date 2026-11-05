-- Worker downloads the photo classifier from the private model bucket (signed URL from the control
-- Lambda) instead of the public site, which git-triggered Vercel builds publish without the model. New pin.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.rg_claim_dispatch_v2(text,integer)'::regprocedure);
  definition := replace(definition, '88ca18dc32cdd0dc92f16bfa14462316e045e21bf5c6426f74880d12d2634c42', '2fd7ab341e6aebcff9b2da56d00626134b52244522384a65fdd81f7e8520ca0a');
  execute definition;
  definition := pg_get_functiondef('public.rg_complete_pinned_job(uuid,bigint,jsonb)'::regprocedure);
  if position('2fd7ab341e6aebcff9b2da56d00626134b52244522384a65fdd81f7e8520ca0a' in definition) = 0 then
    definition := replace(definition, '''88ca18dc32cdd0dc92f16bfa14462316e045e21bf5c6426f74880d12d2634c42'',', '''2fd7ab341e6aebcff9b2da56d00626134b52244522384a65fdd81f7e8520ca0a'',
      ''88ca18dc32cdd0dc92f16bfa14462316e045e21bf5c6426f74880d12d2634c42'',');
    execute definition;
  end if;
end $$;
