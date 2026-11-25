-- Щомісячний список працівників у групу: один запис на місяць, щоб не надсилати двічі.
create table public.monthly_reports (
  month date primary key check (extract(day from month) = 1),
  chat_id bigint not null,
  tg_message_id bigint,
  created_at timestamptz not null default now()
);
alter table public.monthly_reports enable row level security;
create policy monthly_reports_read on public.monthly_reports for select to authenticated using (public.is_member());
revoke all on public.monthly_reports from anon;
revoke insert, update, delete on public.monthly_reports from authenticated;
