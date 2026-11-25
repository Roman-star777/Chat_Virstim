-- Крок 3: службові секрети (лише для службового ключа) і щогодинний запуск нагадувань.

create table public.internal_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.internal_secrets enable row level security;
-- Політик немає: читати може лише службовий ключ (він обходить RLS).
revoke all on public.internal_secrets from anon, authenticated;

-- Ключ запуску генерує сама база; людина його не бачить і не вводить.
insert into public.internal_secrets (name, value)
values ('cron', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;
