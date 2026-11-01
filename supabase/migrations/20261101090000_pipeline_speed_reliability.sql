-- Pipeline speed and reliability (2026-11-01).
-- 1. Stage timestamps so queue, GPU and publication time can be measured per job.
-- 2. A dispatch claim that cannot deadlock on a job whose dispatcher died mid-submit.
-- 3. The faster Kaggle worker sources (parallel downloads, overlapped encoding, retried
--    callbacks) as the active workflow pin; results of the previous pin stay valid.
-- 4. Tighter cron: reconcile Kaggle state every 2 min, sweep the automation every minute.

alter table public.rg_processing_jobs
  add column if not exists dispatched_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists provider_state text,
  add column if not exists provider_checked_at timestamptz;

create or replace function public.rg_claim_dispatch_v2(p_owner text, p_lease_seconds integer default 90)
returns public.rg_processing_jobs language plpgsql security definer set search_path to '' as $function$
declare j public.rg_processing_jobs;
begin
  -- A dispatcher that was killed after claiming leaves "Submitting" with no Kaggle run.
  -- Once its lease is over, put the job back in the queue instead of blocking every upload.
  update public.rg_processing_jobs set status='Queued', lease_owner=null, lease_expires_at=null,
    error='Dispatcher stopped before Kaggle accepted the run; retrying', updated_at=now()
  where provider='kaggle_yolo26' and status='Submitting' and kaggle_kernel_ref is null
    and lease_expires_at < now() - interval '30 seconds';
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
    and jobs.manifest->>'pinned_workflow_sha256'='88fe3e4eef70dbc8ed4470e6ea7e904d14fd6d031fc4b7dd6d7d3730b1d005e0'
    and (jobs.lease_expires_at is null or jobs.lease_expires_at<now())
  order by jobs.created_at for update of jobs skip locked limit 1;
  if j.id is null then return null; end if;
  update public.rg_processing_jobs set status='Submitting',lease_owner=p_owner,
    lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,30),300)),
    submit_attempts=submit_attempts+1,updated_at=now()
    where id=j.id returning * into j;
  return j;
end $function$;

-- Accept results from the new pin in the completion function, keeping every earlier pin.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.rg_complete_pinned_job(uuid,bigint,jsonb)'::regprocedure);
  if position('88fe3e4eef70dbc8ed4470e6ea7e904d14fd6d031fc4b7dd6d7d3730b1d005e0' in definition) = 0 then
    if position('''20d3fc452a6f4575791162fbf28a21a592cf7b9ea8992852940e165459b03eb2'',' in definition) = 0 then
      raise exception 'Completion pin list not found';
    end if;
    definition := replace(definition, '''20d3fc452a6f4575791162fbf28a21a592cf7b9ea8992852940e165459b03eb2'',',
      '''88fe3e4eef70dbc8ed4470e6ea7e904d14fd6d031fc4b7dd6d7d3730b1d005e0'',
      ''20d3fc452a6f4575791162fbf28a21a592cf7b9ea8992852940e165459b03eb2'',');
    execute definition;
  end if;
end $$;

select cron.alter_job((select jobid from cron.job where jobname='riceguard-reconcile'), schedule := '*/2 * * * *');
select cron.alter_job((select jobid from cron.job where jobname='riceguard-auto-pipeline'), schedule := '* * * * *');
