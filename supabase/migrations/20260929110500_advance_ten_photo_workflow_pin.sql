-- Advance the immutable website worker pin after removing presentation text
-- and extending a survey batch to ten photos plus one linked video.
do $$
declare
  previous_hash constant text := '89e9904b0f7b740f0f3ac7f6d5f81073b06c1983d0e87120efa0a337ac9c86e4';
  current_hash constant text := 'f854b9ee8fc7f218a5e40c9b5537bbebc1e0912a355ebbd24adc440290836bd7';
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
