-- Схема бази для Chat_Virstim (крок 1 плану, затверджено 25.11.2026).
-- Таблиці для кроків 3–5 (бот, документи, ШІ) створюються вже зараз, щоб схема була цілісна.
-- Принцип безпеки: RLS увімкнено всюди; читати й писати може лише активний член команди
-- (Роман, Сергій, Саша), чий member_id стоїть у пропуску (JWT), виданому нашим сервером.
-- Бот і планувальник працюють службовим ключем (service_role), який обходить RLS.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Типи
-- ---------------------------------------------------------------------------
create type public.assignee_kind as enum ('person', 'all');
create type public.task_status as enum ('open', 'done');
create type public.doc_status as enum (
  'queued', 'processing', 'classified', 'needs_confirmation', 'confirmed',
  'too_large', 'unsupported', 'error', 'budget_paused'
);
create type public.doc_category as enum ('invoices', 'contracts', 'bank', 'taxes', 'other');
create type public.reminder_kind as enum ('day_before', 'due_today', 'overdue');
create type public.suggestion_status as enum ('pending', 'accepted', 'rejected');

-- ---------------------------------------------------------------------------
-- Люди
-- ---------------------------------------------------------------------------
create table public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  tg_user_id bigint unique,
  tg_username text,
  avatar_letter text not null,
  avatar_color text not null,
  can_manage_employees boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.members (name, avatar_letter, avatar_color, can_manage_employees) values
  ('Роман',  'Р', '#5b8def', true),
  ('Сергій', 'С', '#a78bfa', true),
  ('Саша',   'С', '#f5b942', false);

-- Хто відкрив міні-апку, але ще не привʼязаний до імені. Підтверджує Роман або Сергій.
create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  tg_user_id bigint not null unique,
  tg_first_name text,
  tg_last_name text,
  tg_username text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.members(id),
  resolution text check (resolution in ('approved', 'rejected'))
);

-- ---------------------------------------------------------------------------
-- Налаштування (один рядок)
-- ---------------------------------------------------------------------------
create table public.settings (
  id int primary key default 1 check (id = 1),
  group_chat_id bigint,
  timezone text not null default 'Europe/Prague',
  reminder_hour int not null default 9 check (reminder_hour between 0 and 23),
  remind_day_before boolean not null default true,
  remind_due_today boolean not null default true,
  remind_overdue boolean not null default true,
  ai_model text not null default 'claude-opus-5-5',
  ai_confidence_threshold numeric(3,2) not null default 0.80
    check (ai_confidence_threshold between 0 and 1),
  ai_monthly_budget_usd numeric(10,2) not null default 30,
  ai_notice_sent_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- ---------------------------------------------------------------------------
-- Повідомлення з групи (крок 3)
-- ---------------------------------------------------------------------------
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  tg_chat_id bigint not null,
  tg_message_id bigint not null,
  from_tg_user_id bigint,
  from_member_id uuid references public.members(id),
  text text,
  sent_at timestamptz not null,
  reply_to_tg_message_id bigint,
  has_file boolean not null default false,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tg_chat_id, tg_message_id)
);
create index chat_messages_sent_at_idx on public.chat_messages (sent_at desc);

-- ---------------------------------------------------------------------------
-- Документи (крок 4)
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  sha256 text unique,                      -- null лише для «завеликих» (не скачані)
  tg_file_unique_id text,
  tg_file_id text,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  storage_path text,
  uploaded_by uuid references public.members(id),
  source_message_id uuid references public.chat_messages(id),
  status public.doc_status not null default 'queued',
  category public.doc_category not null default 'other',
  ai_category_guess public.doc_category,
  ai_confidence numeric(3,2),
  counterparty text,
  amount numeric(14,2),
  currency text,
  doc_date date,
  period text,
  short_title text,
  ai_raw jsonb,
  attempts int not null default 0,
  confirmed_by uuid references public.members(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_created_at_idx on public.documents (created_at desc);
create index documents_status_idx on public.documents (status);

-- ---------------------------------------------------------------------------
-- Задачі
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 500),
  created_by uuid not null references public.members(id),
  assignee_kind public.assignee_kind not null,
  assignee_id uuid references public.members(id),
  due_date date,
  important boolean not null default false,
  remind boolean not null default true,
  status public.task_status not null default 'open',
  done_at timestamptz,
  done_by uuid references public.members(id),
  source_message_id uuid references public.chat_messages(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((assignee_kind = 'person') = (assignee_id is not null))
);
create index tasks_status_due_idx on public.tasks (status, due_date);

-- Галочки для задач «Усі»: задача виконана, коли відмітили всі активні члени команди.
create table public.task_completions (
  task_id uuid not null references public.tasks(id) on delete cascade,
  member_id uuid not null references public.members(id),
  completed_at timestamptz not null default now(),
  primary key (task_id, member_id)
);

create table public.task_documents (
  task_id uuid not null references public.tasks(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  primary key (task_id, document_id)
);

-- ---------------------------------------------------------------------------
-- Облік ШІ, нагадування, пропозиції задач (кроки 3–5)
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  purpose text not null check (purpose in ('document', 'task_suggestion')),
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cost_usd numeric(10,5) not null default 0,
  document_id uuid references public.documents(id) on delete set null
);
create index ai_usage_created_at_idx on public.ai_usage (created_at);

create table public.reminder_log (
  id bigserial primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  kind public.reminder_kind not null,
  for_date date not null,
  sent_at timestamptz not null default now(),
  unique (task_id, kind, for_date)
);

create table public.task_suggestions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  proposed jsonb not null,
  status public.suggestion_status not null default 'pending',
  decided_by uuid references public.members(id),
  decided_at timestamptz,
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Працівники
-- ---------------------------------------------------------------------------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 200),
  contract_type text not null check (char_length(btrim(contract_type)) between 1 and 50),
  hours numeric(6,2) check (hours is null or hours >= 0),
  hours_unit text not null default 'week' check (hours_unit in ('week', 'month')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.members(id)
);

create table public.employee_changes (
  id bigserial primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  changed_by uuid references public.members(id),
  changed_at timestamptz not null default now(),
  action text not null check (action in ('create', 'update', 'deactivate', 'reactivate', 'import')),
  old_values jsonb,
  new_values jsonb
);
create index employee_changes_employee_idx on public.employee_changes (employee_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- Хто я (з пропуску)
-- ---------------------------------------------------------------------------
create or replace function public.current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select m.id
  from public.members m
  where m.active
    and m.id = nullif(auth.jwt() ->> 'member_id', '')::uuid
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_member_id() is not null
$$;

create or replace function public.can_manage_employees() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.can_manage_employees from public.members m where m.id = public.current_member_id()),
    false)
$$;

-- ---------------------------------------------------------------------------
-- Правила задач
-- ---------------------------------------------------------------------------
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_member_id();
begin
  if tg_op = 'INSERT' then
    if me is not null and new.created_by <> me then
      raise exception 'Задачу можна створити лише від свого імені' using errcode = '42501';
    end if;
    new.status := 'open';
    new.done_at := null;
    new.done_by := null;
    return new;
  end if;

  -- UPDATE. me = null означає системний виклик (бот / планувальник зі службовим ключем).
  if new.created_by is distinct from old.created_by then
    raise exception 'Автора задачі змінити не можна' using errcode = '42501';
  end if;

  if me is not null
     and (new.title, new.assignee_kind, new.assignee_id, new.due_date, new.important, new.remind)
         is distinct from
         (old.title, old.assignee_kind, old.assignee_id, old.due_date, old.important, old.remind)
     and old.created_by <> me then
    raise exception 'Змінювати текст, виконавця чи термін може лише автор задачі' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if old.assignee_kind = 'all' then
      if coalesce(current_setting('app.completion_sync', true), '') <> '1' then
        raise exception 'Задачу «Усі» закривають галочки кожного з трьох' using errcode = '42501';
      end if;
    elsif me is not null and old.assignee_id <> me then
      raise exception 'Закрити або відкрити задачу може лише виконавець' using errcode = '42501';
    end if;

    if new.status = 'done' then
      new.done_at := now();
      new.done_by := case when old.assignee_kind = 'all' then null else coalesce(me, old.assignee_id) end;
    else
      new.done_at := null;
      new.done_by := null;
    end if;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger tasks_guard_ins before insert on public.tasks
  for each row execute function public.tasks_guard();
create trigger tasks_guard_upd before update on public.tasks
  for each row execute function public.tasks_guard();

-- Після кожної галочки на задачі «Усі» перераховуємо, чи всі відмітили.
create or replace function public.sync_all_task_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t_id uuid := coalesce(new.task_id, old.task_id);
  done_count int;
  need_count int;
begin
  select count(*) into done_count
  from public.task_completions c
  join public.members m on m.id = c.member_id and m.active
  where c.task_id = t_id;

  select count(*) into need_count from public.members where active;

  perform set_config('app.completion_sync', '1', true);
  update public.tasks
     set status = case when done_count >= need_count then 'done'::public.task_status
                       else 'open'::public.task_status end
   where id = t_id and assignee_kind = 'all';
  perform set_config('app.completion_sync', '', true);
  return null;
end $$;

create trigger task_completions_sync
  after insert or delete on public.task_completions
  for each row execute function public.sync_all_task_status();

-- ---------------------------------------------------------------------------
-- Правила працівників + журнал змін
-- ---------------------------------------------------------------------------
create or replace function public.employees_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_member_id();
begin
  if tg_op = 'UPDATE' and me is not null and not public.can_manage_employees() then
    if (new.full_name, new.hours, new.hours_unit, new.active)
       is distinct from (old.full_name, old.hours, old.hours_unit, old.active) then
      raise exception 'Ви можете змінювати лише тип договору' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(me, new.updated_by);
  return new;
end $$;

create trigger employees_guard before insert or update on public.employees
  for each row execute function public.employees_guard();

create or replace function public.employees_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb;
  n jsonb := jsonb_build_object('full_name', new.full_name, 'contract_type', new.contract_type,
                                'hours', new.hours, 'hours_unit', new.hours_unit, 'active', new.active);
  act text;
begin
  if tg_op = 'INSERT' then
    act := coalesce(nullif(current_setting('app.employee_action', true), ''), 'create');
    insert into public.employee_changes (employee_id, changed_by, action, old_values, new_values)
    values (new.id, new.updated_by, act, null, n);
    return null;
  end if;

  o := jsonb_build_object('full_name', old.full_name, 'contract_type', old.contract_type,
                          'hours', old.hours, 'hours_unit', old.hours_unit, 'active', old.active);
  if o = n then
    return null;  -- нічого не змінилось
  end if;
  act := case
    when old.active and not new.active then 'deactivate'
    when not old.active and new.active then 'reactivate'
    else 'update' end;
  insert into public.employee_changes (employee_id, changed_by, action, old_values, new_values)
  values (new.id, new.updated_by, act, o, n);
  return null;
end $$;

create trigger employees_log after insert or update on public.employees
  for each row execute function public.employees_log();

-- updated_at для решти таблиць
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger documents_touch before update on public.documents
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.members           enable row level security;
alter table public.access_requests   enable row level security;
alter table public.settings          enable row level security;
alter table public.chat_messages     enable row level security;
alter table public.documents         enable row level security;
alter table public.tasks             enable row level security;
alter table public.task_completions  enable row level security;
alter table public.task_documents    enable row level security;
alter table public.ai_usage          enable row level security;
alter table public.reminder_log      enable row level security;
alter table public.task_suggestions  enable row level security;
alter table public.employees         enable row level security;
alter table public.employee_changes  enable row level security;

-- Читати все можуть лише члени команди
create policy members_read          on public.members          for select to authenticated using (public.is_member());
create policy access_requests_read  on public.access_requests  for select to authenticated using (public.is_member());
create policy settings_read         on public.settings         for select to authenticated using (public.is_member());
create policy chat_messages_read    on public.chat_messages    for select to authenticated using (public.is_member());
create policy documents_read        on public.documents        for select to authenticated using (public.is_member());
create policy tasks_read            on public.tasks            for select to authenticated using (public.is_member());
create policy task_completions_read on public.task_completions for select to authenticated using (public.is_member());
create policy task_documents_read   on public.task_documents   for select to authenticated using (public.is_member());
create policy ai_usage_read         on public.ai_usage         for select to authenticated using (public.is_member());
create policy reminder_log_read     on public.reminder_log     for select to authenticated using (public.is_member());
create policy task_suggestions_read on public.task_suggestions for select to authenticated using (public.is_member());
create policy employees_read        on public.employees        for select to authenticated using (public.is_member());
create policy employee_changes_read on public.employee_changes for select to authenticated using (public.is_member());

-- Запис
create policy settings_update on public.settings for update to authenticated
  using (public.is_member()) with check (public.is_member());

create policy documents_update on public.documents for update to authenticated
  using (public.is_member()) with check (public.is_member());

create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.is_member() and created_by = public.current_member_id());
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_member()) with check (public.is_member());
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_member() and created_by = public.current_member_id());

create policy task_completions_insert on public.task_completions for insert to authenticated
  with check (
    member_id = public.current_member_id()
    and exists (select 1 from public.tasks t where t.id = task_id and t.assignee_kind = 'all')
  );
create policy task_completions_delete on public.task_completions for delete to authenticated
  using (member_id = public.current_member_id());

create policy task_documents_insert on public.task_documents for insert to authenticated
  with check (public.is_member());
create policy task_documents_delete on public.task_documents for delete to authenticated
  using (public.is_member());

create policy employees_insert on public.employees for insert to authenticated
  with check (public.can_manage_employees());
create policy employees_update on public.employees for update to authenticated
  using (public.is_member()) with check (public.is_member());
-- Видалення працівників немає: «Прибрати» = active = false, історія лишається.

-- Анонімний доступ закритий повністю
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

-- ---------------------------------------------------------------------------
-- Приватне сховище файлів (лише в Supabase; локальні тести його пропускають)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
    on conflict (id) do nothing;
  end if;
end $$;
