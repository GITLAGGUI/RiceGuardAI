-- The Kaggle worker now also runs the website photo classifier on its GPU (results saved per photo
-- through worker-callback "photo-classifications"). New worker sources = new workflow pin.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.rg_claim_dispatch_v2(text,integer)'::regprocedure);
  definition := replace(definition, '88fe3e4eef70dbc8ed4470e6ea7e904d14fd6d031fc4b7dd6d7d3730b1d005e0', '39f09b61117106fa6d5bf21a7e85f26d8e3d74f7c2d2c03de90eb3909f2ed90e');
  execute definition;
  definition := pg_get_functiondef('public.rg_complete_pinned_job(uuid,bigint,jsonb)'::regprocedure);
  if position('39f09b61117106fa6d5bf21a7e85f26d8e3d74f7c2d2c03de90eb3909f2ed90e' in definition) = 0 then
    definition := replace(definition, '''88fe3e4eef70dbc8ed4470e6ea7e904d14fd6d031fc4b7dd6d7d3730b1d005e0'',', '''39f09b61117106fa6d5bf21a7e85f26d8e3d74f7c2d2c03de90eb3909f2ed90e'',
      ''88fe3e4eef70dbc8ed4470e6ea7e904d14fd6d031fc4b7dd6d7d3730b1d005e0'',');
    execute definition;
  end if;
end $$;
