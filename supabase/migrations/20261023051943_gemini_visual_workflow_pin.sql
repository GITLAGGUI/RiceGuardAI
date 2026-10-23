-- Advance packaged worker code only. Existing job manifests/results are immutable.
-- Execute during a drained release; this never restarts or rewrites queued jobs.
do $migration$
declare
 old_pin constant text := '09533f998a7e51ad8f44703aef1d7dee8eb91b4251681a538cabe881b5bec5b0';
 legacy_pin constant text := '7695ca57f8d093c05fe73c916bb9c13315b615b6210ef76343dae0423a84ab62';
 new_pin constant text := 'df3d156e64d778ea818fdb34005a340570661d40e0d9a306ec891087f68a35de';
 definition text; previous_guard text; next_guard text;
begin
 lock table public.rg_processing_jobs in share row exclusive mode;
 if exists(select 1 from public.rg_processing_jobs where provider='kaggle_yolo26'
   and status in ('Queued','Submitting','Running','Waiting for GPU','Validating results')) then
   raise exception 'Drain active pinned jobs before advancing the advisory workflow';
 end if;
 select pg_get_functiondef('public.rg_claim_dispatch_v2(text,integer)'::regprocedure) into definition;
 if position(new_pin in definition)=0 then
   if (length(definition)-length(replace(definition,old_pin,''))) / length(old_pin) <> 1 then
     raise exception 'Unexpected prior dispatch workflow pin';
   end if;
   execute replace(definition,old_pin,new_pin);
 end if;
 previous_guard:=format('coalesce(j.manifest->>''pinned_workflow_sha256'', '''') not in (%L, %L)',legacy_pin,old_pin);
 next_guard:=format('coalesce(j.manifest->>''pinned_workflow_sha256'', '''') not in (%L, %L, %L)',legacy_pin,old_pin,new_pin);
 select pg_get_functiondef('public.rg_complete_pinned_job(uuid,bigint,jsonb)'::regprocedure) into definition;
 if position(next_guard in definition)=0 then
   if (length(definition)-length(replace(definition,previous_guard,''))) / length(previous_guard) <> 1 then
     raise exception 'Unexpected prior callback workflow pin';
   end if;
   -- Preserve every other guard, including result workflow == exact job workflow.
   execute replace(definition,previous_guard,next_guard);
 end if;
end $migration$;
