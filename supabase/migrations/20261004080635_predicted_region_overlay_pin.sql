-- Display-only workflow revision. Model hashes and stored outputs are unchanged.
-- Preserve callbacks from already-frozen old jobs; bind every result to its job.
do $migration$
declare
  previous_hash constant text := '7695ca57f8d093c05fe73c916bb9c13315b615b6210ef76343dae0423a84ab62';
  current_hash constant text := '09533f998a7e51ad8f44703aef1d7dee8eb91b4251681a538cabe881b5bec5b0';
  definition text;
  revised text;
begin
  -- Fail closed rather than changing the pin of an in-flight/queued job.
  lock table public.rg_processing_jobs in share row exclusive mode;
  if exists(select 1 from public.rg_processing_jobs where provider='kaggle_yolo26'
    and status in ('Queued','Submitting','Running','Waiting for GPU')) then
    raise exception 'Drain active pinned jobs before advancing the overlay pin';
  end if;
  select pg_get_functiondef('public.rg_claim_dispatch_v2(text,integer)'::regprocedure)
    into definition;
  if position(current_hash in definition) = 0 then
    if position(previous_hash in definition) = 0 then
      raise exception 'Unexpected prior dispatch workflow pin';
    end if;
    execute replace(definition, previous_hash, current_hash);
  end if;

  select pg_get_functiondef('public.rg_complete_pinned_job(uuid,bigint,jsonb)'::regprocedure)
    into definition;
  if position(current_hash in definition) = 0 then
    revised := regexp_replace(definition,
      'j\.manifest->>''pinned_workflow_sha256''\s+is distinct from\s+''' || previous_hash || '''',
      format('coalesce(j.manifest->>''pinned_workflow_sha256'', '''') not in (%L, %L)', previous_hash, current_hash));
    if revised = definition or
      position('j.manifest->>''pinned_workflow_sha256''' in revised) = 0 then
      raise exception 'Unexpected prior callback workflow pin';
    end if;
    execute revised;
  end if;
end $migration$;
