-- Isolate private inference polling from the older SMS/Kaggle cron secret.
-- The URL and AWS-only bearer secret are provisioned separately in Vault.
create function private.rg_invoke_aws_edge(p_function text) returns bigint
language plpgsql security definer set search_path='' as $$
declare project_url text; cron_secret text; request_id bigint;
begin
  if p_function not in ('aws-dispatcher','aws-reconciler') then
    raise exception 'Unsupported private inference function';
  end if;
  select decrypted_secret into project_url from vault.decrypted_secrets
    where name='riceguard_project_url' limit 1;
  select decrypted_secret into cron_secret from vault.decrypted_secrets
    where name='riceguard_aws_cron_secret' limit 1;
  if project_url is null or cron_secret is null then return null; end if;
  select net.http_post(
    url := rtrim(project_url,'/') || '/functions/v1/' || p_function,
    headers := jsonb_build_object('Authorization','Bearer '||cron_secret,
      'Content-Type','application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into request_id;
  return request_id;
end $$;
revoke all on function private.rg_invoke_aws_edge(text) from public,anon,authenticated;

select cron.schedule('riceguard-aws-dispatch','*/2 * * * *',
  $schedule$select private.rg_invoke_aws_edge('aws-dispatcher')$schedule$);
select cron.schedule('riceguard-aws-reconcile','*/5 * * * *',
  $schedule$select private.rg_invoke_aws_edge('aws-reconciler')$schedule$);
