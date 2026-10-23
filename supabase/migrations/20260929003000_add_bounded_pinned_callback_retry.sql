-- Advance the immutable workflow pin for the bounded, idempotent callback
-- retry used during a new Kaggle runtime's initial regional cold start.
do $$
declare
  previous_hash constant text := 'ed5ed92ee7b7da8fc2f4fb809aaa8428dfaad06aa9b07d3727fde0816250b338';
  corrected_hash constant text := '89e9904b0f7b740f0f3ac7f6d5f81073b06c1983d0e87120efa0a337ac9c86e4';
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
