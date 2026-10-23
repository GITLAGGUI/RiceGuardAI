-- Durable retry discovery only; claim_notice performs the locked final checks.
create function public.rg_mcp_notice_candidates() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('event_id',candidate.id)),'[]'::jsonb)
 from (
  select e.id from rg_mcp.ready_events e
  join public.rg_surveys s on s.id=e.survey_id and s.archived_at is null and s.active_result_revision=e.result_revision
  join rg_mcp.visual_catalogues v on v.survey_id=e.survey_id and v.job_id=e.job_id
    and v.result_revision=e.result_revision and v.catalogue_sha256=e.catalogue_sha256
  where e.notice_attempts<5 and (
    e.status='pending' or (e.status in ('failed','leased') and e.lease_expires_at<=now()))
    and e.failure_code is distinct from 'manual_reconciliation'
    and exists(select 1 from rg_mcp.grants g
      join rg_mcp.survey_access a on a.grant_id=g.id and a.survey_id=e.survey_id and a.revoked_at is null
      join rg_mcp.clients c on c.client_id=g.client_id and c.owner_id=g.owner_id and c.resource=g.resource
      join public.profiles p on p.id=g.owner_id and p.role='admin' and p.is_active
      where g.allow_images and g.revoked_at is null and g.expires_at>now()
        and array['evidence:read','advisory:submit']::text[] <@ g.scopes
        and c.revoked_at is null and c.expires_at>now())
  order by e.created_at,e.id limit 3
 ) candidate;
$$;
revoke all on function public.rg_mcp_notice_candidates() from public,anon,authenticated;
grant execute on function public.rg_mcp_notice_candidates() to service_role;

-- Fixed destination; reuse the existing private Vault-backed cron invocation.
-- No token literals, new provider permissions, mailbox access or SMS scheduler.
create function private.rg_invoke_advisory_notifier() returns bigint
language sql security definer set search_path='' as $$
 select private.rg_invoke_edge('advisory-notifier');
$$;
revoke all on function private.rg_invoke_advisory_notifier() from public,anon,authenticated;
select cron.schedule('riceguard-advisory-notices','*/2 * * * *',
 $schedule$select private.rg_invoke_advisory_notifier()$schedule$);
