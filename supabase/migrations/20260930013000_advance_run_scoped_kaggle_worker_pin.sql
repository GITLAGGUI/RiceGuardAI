-- Advance the pinned website workflow after making Kaggle executions
-- run-scoped and bounding/retrying private artifact uploads.
do $$
declare
  previous_hash constant text := '8a02cb4a3bf996a1f67f84aebdcf950cca33f98afe3b92cc2f253c3fae47b0b5';
  current_hash constant text := '7695ca57f8d093c05fe73c916bb9c13315b615b6210ef76343dae0423a84ab62';
  definition text;
begin
  select pg_get_functiondef('public.rg_claim_dispatch_v2(text,integer)'::regprocedure)
    into definition;
  if position(current_hash in definition) = 0 then
    if position(previous_hash in definition) = 0 then
      raise exception 'rg_claim_dispatch_v2 does not contain the expected prior workflow pin';
    end if;
    execute replace(definition, previous_hash, current_hash);
  end if;

  select pg_get_functiondef('public.rg_complete_pinned_job(uuid,bigint,jsonb)'::regprocedure)
    into definition;
  if position(current_hash in definition) = 0 then
    if position(previous_hash in definition) = 0 then
      raise exception 'rg_complete_pinned_job does not contain the expected prior workflow pin';
    end if;
    execute replace(definition, previous_hash, current_hash);
  end if;
end $$;
