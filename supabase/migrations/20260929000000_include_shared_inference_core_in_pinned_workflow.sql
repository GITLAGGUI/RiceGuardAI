-- Advance the immutable Kaggle worker pin after adding the shared inference
-- engine to the private package. Existing jobs keep their original manifest;
-- only newly-created jobs can be claimed by the corrected worker.
do $$
declare
  previous_hash constant text := 'bc8dc16cd98949221cc282c830d9cad146dee71108e8a838cb7372e2016df21c';
  corrected_hash constant text := 'ed5ed92ee7b7da8fc2f4fb809aaa8428dfaad06aa9b07d3727fde0816250b338';
  definition text;
begin
  select pg_get_functiondef('public.rg_claim_dispatch_v2(text,integer)'::regprocedure)
    into definition;
  if position(corrected_hash in definition) = 0 then
    if position(previous_hash in definition) = 0 then
      raise exception 'rg_claim_dispatch_v2 does not contain the expected workflow pin';
    end if;
    execute replace(definition, previous_hash, corrected_hash);
  end if;

  select pg_get_functiondef('public.rg_complete_pinned_job(uuid,bigint,jsonb)'::regprocedure)
    into definition;
  if position(corrected_hash in definition) = 0 then
    if position(previous_hash in definition) = 0 then
      raise exception 'rg_complete_pinned_job does not contain the expected workflow pin';
    end if;
    execute replace(definition, previous_hash, corrected_hash);
  end if;
end $$;
