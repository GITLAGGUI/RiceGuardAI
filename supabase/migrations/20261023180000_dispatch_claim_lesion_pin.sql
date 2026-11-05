-- The dispatch claim still matched only the YOLO26m workflow pin, so lesion-bundle jobs
-- waited in "Queued" forever. Claim the active pin.
create or replace function public.rg_claim_dispatch_v2(p_owner text, p_lease_seconds integer default 90)
returns public.rg_processing_jobs language plpgsql security definer set search_path to '' as $function$
declare j public.rg_processing_jobs;
begin
  if exists(select 1 from public.rg_processing_jobs active
    where active.provider='kaggle_yolo26'
      and active.status in ('Submitting','Running','Validating results'))
    then return null; end if;
  select jobs.* into j
  from public.rg_processing_jobs jobs
  join public.rg_outbox outbox on outbox.entity_id=jobs.id
    and outbox.kind='kaggle-dispatch' and outbox.state='pending'
    and outbox.available_at<=now()
  where jobs.provider='kaggle_yolo26'
    and jobs.status in ('Queued','Waiting for GPU')
    and jobs.manifest->>'execution_provider'='kaggle_yolo26'
    and jobs.manifest->>'pinned_workflow_sha256'='20d3fc452a6f4575791162fbf28a21a592cf7b9ea8992852940e165459b03eb2'
    and (jobs.lease_expires_at is null or jobs.lease_expires_at<now())
  order by jobs.created_at for update of jobs skip locked limit 1;
  if j.id is null then return null; end if;
  update public.rg_processing_jobs set status='Submitting',lease_owner=p_owner,
    lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,30),300)),
    submit_attempts=submit_attempts+1,updated_at=now()
    where id=j.id returning * into j;
  return j;
end $function$;
-- Dispatch every minute; uploads also kick the dispatcher directly.
select cron.alter_job((select jobid from cron.job where jobname='riceguard-dispatch'), schedule := '* * * * *');
-- Inalis: ang Supabase CLI na mismo ang nagtatala ng migration na ito; ang manu-manong insert ay nagpapapalya sa `supabase start`.
select private.rg_invoke_edge('job-dispatcher');
