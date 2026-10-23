-- Restrict the aggregate grade to accepted diseases in the current reviewed result.
-- Keep assessment history, approval gates and existing function privileges intact.
do $migration$
declare
  definition text;
  previous text := 'else ''low'' end into category from jsonb_each(combined);';
  revised text;
begin
  select pg_get_functiondef('public.rg_save_field_severity(uuid,integer,uuid,jsonb)'::regprocedure) into definition;
  if position('from jsonb_each(combined) where key=any(b.diseases)' in definition) = 0 then
    if position(previous in definition) = 0 then raise exception 'Unexpected prior severity aggregate'; end if;
    revised := replace(definition, previous,
      'else ''low'' end into category from jsonb_each(combined) where key=any(b.diseases);');
    execute revised;
  end if;
end $migration$;
