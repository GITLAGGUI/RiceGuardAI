-- Archive is recoverable and never removes private field source media.
alter table public.rg_surveys add column if not exists archived_at timestamptz;
alter table public.rg_bulletins add column if not exists archived_at timestamptz;
