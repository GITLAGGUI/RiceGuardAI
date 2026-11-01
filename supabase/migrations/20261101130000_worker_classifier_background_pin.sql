-- Worker prepares the photo classifier in a background thread (no added wait). New pin.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.rg_claim_dispatch_v2(text,integer)'::regprocedure);
  definition := replace(definition, '39f09b61117106fa6d5bf21a7e85f26d8e3d74f7c2d2c03de90eb3909f2ed90e', '88ca18dc32cdd0dc92f16bfa14462316e045e21bf5c6426f74880d12d2634c42');
  execute definition;
  definition := pg_get_functiondef('public.rg_complete_pinned_job(uuid,bigint,jsonb)'::regprocedure);
  if position('88ca18dc32cdd0dc92f16bfa14462316e045e21bf5c6426f74880d12d2634c42' in definition) = 0 then
    definition := replace(definition, '''39f09b61117106fa6d5bf21a7e85f26d8e3d74f7c2d2c03de90eb3909f2ed90e'',', '''88ca18dc32cdd0dc92f16bfa14462316e045e21bf5c6426f74880d12d2634c42'',
      ''39f09b61117106fa6d5bf21a7e85f26d8e3d74f7c2d2c03de90eb3909f2ed90e'',');
    execute definition;
  end if;
end $$;
