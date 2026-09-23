-- SMS delivery has its own cron credentials. Do not implicitly activate the
-- unrelated Kaggle dispatch jobs while their providers are unconfigured.
create or replace function private.rg_invoke_sms_edge() returns bigint
language plpgsql security definer set search_path='' as $$
declare project_url text; cron_secret text; request_id bigint;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets
    where name='riceguard_sms_project_url' limit 1;
  select decrypted_secret into cron_secret from vault.decrypted_secrets
    where name='riceguard_sms_cron_secret' limit 1;
  if project_url is null or cron_secret is null then return null; end if;
  select net.http_post(
    url := rtrim(project_url,'/') || '/functions/v1/send-sms',
    headers := jsonb_build_object('Authorization','Bearer '||cron_secret,'Content-Type','application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into request_id;
  return request_id;
end $$;
revoke all on function private.rg_invoke_sms_edge() from public,anon,authenticated;

do $$ declare job_id bigint; begin
  select jobid into job_id from cron.job where jobname='riceguard-sms';
  if job_id is not null then perform cron.unschedule(job_id); end if;
  perform cron.schedule('riceguard-sms','*/5 * * * *',
    $job$select private.rg_invoke_sms_edge();$job$);
end $$;
