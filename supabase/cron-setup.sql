-- Лише в Supabase (не в локальних тестах): щогодини о :00 UTC викликати нагадування.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'virstim-reminders-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://chat-virstim.vercel.app/api/cron/reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select value from public.internal_secrets where name = 'cron')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
