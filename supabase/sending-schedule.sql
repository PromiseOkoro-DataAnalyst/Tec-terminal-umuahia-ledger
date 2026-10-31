-- =====================================================================
--  Turn on automatic sending (run once, after messaging.sql and after
--  the send-messages Edge Function is deployed).
--  Creates a private password for the job and runs the sender every 10 minutes.
-- =====================================================================
create table if not exists public.app_secrets (
  name text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;   -- no policies: only the server can read it
revoke all on public.app_secrets from anon, authenticated;

insert into public.app_secrets (name, value)
values ('cron', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

select cron.unschedule('send-messages') where exists (select 1 from cron.job where cron.job.jobname = 'send-messages');
select cron.schedule('send-messages', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://gcdlmpbydbtbikmijksi.supabase.co/functions/v1/send-messages',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select public.app_secrets.value from public.app_secrets where public.app_secrets.name = 'cron')),
    body := '{}'::jsonb)
$$);
