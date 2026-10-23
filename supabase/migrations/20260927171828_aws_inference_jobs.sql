-- Add AWS jobs alongside historical Kaggle runs without repurposing the
-- Kaggle kernel reference. Existing rows retain provider='kaggle'.
alter table public.rg_surveys
  add column inference_provider text not null default 'kaggle'
    check (inference_provider in ('kaggle', 'aws'));

alter table public.rg_processing_jobs
  add column provider text not null default 'kaggle'
    check (provider in ('kaggle', 'aws')),
  add column aws_job_ref text;

create index rg_jobs_provider_queue
  on public.rg_processing_jobs(provider, status, created_at)
  where status in ('Queued', 'Waiting for GPU');

-- The pre-existing cron/RPC must never steal AWS work during a staged rollout.
create or replace function public.rg_claim_dispatch_v2(p_owner text,p_lease_seconds integer default 90)
returns public.rg_processing_jobs language plpgsql security definer set search_path='' as $$
declare j public.rg_processing_jobs;
begin
  select jobs.* into j
  from public.rg_processing_jobs jobs
  join public.rg_outbox outbox on outbox.entity_id=jobs.id
    and outbox.kind='kaggle-dispatch' and outbox.state='pending'
    and outbox.available_at<=now()
  where jobs.provider='kaggle'
    and jobs.status in ('Queued','Waiting for GPU')
    and (jobs.lease_expires_at is null or jobs.lease_expires_at<now())
  order by jobs.created_at for update of jobs skip locked limit 1;
  if j.id is null then return null; end if;
  update public.rg_processing_jobs set status='Submitting',lease_owner=p_owner,
    lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,30),300)),
    submit_attempts=submit_attempts+1,updated_at=now()
    where id=j.id returning * into j;
  return j;
end $$;
revoke all on function public.rg_claim_dispatch_v2(text,integer) from public,anon,authenticated;
grant execute on function public.rg_claim_dispatch_v2(text,integer) to service_role;

create function public.rg_claim_aws_dispatch(p_owner text,p_lease_seconds integer default 120)
returns public.rg_processing_jobs language plpgsql security definer set search_path='' as $$
declare j public.rg_processing_jobs;
begin
  select jobs.* into j
  from public.rg_processing_jobs jobs
  join public.rg_outbox outbox on outbox.entity_id=jobs.id
    and outbox.kind='aws-dispatch' and outbox.state='pending'
    and outbox.available_at<=now()
  where jobs.provider='aws' and jobs.status='Queued'
    and (jobs.lease_expires_at is null or jobs.lease_expires_at<now())
  order by jobs.created_at for update of jobs skip locked limit 1;
  if j.id is null then return null; end if;
  update public.rg_processing_jobs set status='Submitting',lease_owner=p_owner,
    lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,30),300)),
    submit_attempts=submit_attempts+1,updated_at=now()
    where id=j.id returning * into j;
  return j;
end $$;
revoke all on function public.rg_claim_aws_dispatch(text,integer) from public,anon,authenticated;
grant execute on function public.rg_claim_aws_dispatch(text,integer) to service_role;
