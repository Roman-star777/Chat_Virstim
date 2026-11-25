-- Години працівників окремо для кожного місяця + типи договору лише DPP, DPČ, HPP.
-- Наявні години (фактичні за жовтень 2026) переносяться в місяць 2026-10.

-- 1. Таблиця годин по місяцях
create table public.employee_hours (
  employee_id uuid not null references public.employees(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  hours numeric(6,2) not null check (hours >= 0 and hours <= 9999),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.members(id),
  primary key (employee_id, month)
);

-- 2. Перенести жовтневі години (до створення тригера журналу: це не нова зміна)
insert into public.employee_hours (employee_id, month, hours, updated_at, updated_by)
select id, date '2026-10-01', hours, updated_at, updated_by
from public.employees where hours is not null;

-- 3. Нові правила і журнал для таблиці працівників (без годин)
create or replace function public.employees_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_member_id();
begin
  if tg_op = 'UPDATE' and me is not null and not public.can_manage_employees() then
    if (new.full_name, new.active) is distinct from (old.full_name, old.active) then
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

create or replace function public.employees_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb;
  n jsonb := jsonb_build_object('full_name', new.full_name, 'contract_type', new.contract_type, 'active', new.active);
  act text;
begin
  if tg_op = 'INSERT' then
    act := coalesce(nullif(current_setting('app.employee_action', true), ''), 'create');
    insert into public.employee_changes (employee_id, changed_by, action, old_values, new_values)
    values (new.id, new.updated_by, act, null, n);
    return null;
  end if;
  o := jsonb_build_object('full_name', old.full_name, 'contract_type', old.contract_type, 'active', old.active);
  if o = n then
    return null;
  end if;
  act := case
    when old.active and not new.active then 'deactivate'
    when not old.active and new.active then 'reactivate'
    else 'update' end;
  insert into public.employee_changes (employee_id, changed_by, action, old_values, new_values)
  values (new.id, new.updated_by, act, o, n);
  return null;
end $$;

alter table public.employees drop column hours, drop column hours_unit;

-- 4. Лише три типи договору
alter table public.employees add constraint employees_contract_type_check3
  check (contract_type in ('DPP', 'DPČ', 'HPP'));

-- 5. Журнал змін годин
alter table public.employee_changes drop constraint employee_changes_action_check;
alter table public.employee_changes add constraint employee_changes_action_check
  check (action in ('create', 'update', 'deactivate', 'reactivate', 'import', 'hours'));

create or replace function public.employee_hours_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(public.current_member_id(), new.updated_by);
  return new;
end $$;

create trigger employee_hours_stamp before insert or update on public.employee_hours
  for each row execute function public.employee_hours_stamp();

create or replace function public.employee_hours_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.employee_hours := coalesce(new, old);
  m text := to_char(r.month, 'YYYY-MM');
begin
  if tg_op = 'UPDATE' and new.hours = old.hours then
    return null;
  end if;
  insert into public.employee_changes (employee_id, changed_by, action, old_values, new_values)
  values (
    r.employee_id,
    coalesce(public.current_member_id(), r.updated_by),
    'hours',
    case when tg_op = 'INSERT' then jsonb_build_object('month', m, 'hours', null)
         else jsonb_build_object('month', m, 'hours', old.hours) end,
    case when tg_op = 'DELETE' then jsonb_build_object('month', m, 'hours', null)
         else jsonb_build_object('month', m, 'hours', new.hours) end
  );
  return null;
end $$;

create trigger employee_hours_log after insert or update or delete on public.employee_hours
  for each row execute function public.employee_hours_log();

-- 6. Доступ: бачать усі троє, години міняють лише Роман і Сергій
alter table public.employee_hours enable row level security;
create policy employee_hours_read on public.employee_hours for select to authenticated
  using (public.is_member());
create policy employee_hours_insert on public.employee_hours for insert to authenticated
  with check (public.can_manage_employees());
create policy employee_hours_update on public.employee_hours for update to authenticated
  using (public.can_manage_employees()) with check (public.can_manage_employees());
create policy employee_hours_delete on public.employee_hours for delete to authenticated
  using (public.can_manage_employees());

revoke all on public.employee_hours from anon;
grant select, insert, update, delete on public.employee_hours to authenticated;
revoke execute on function public.employee_hours_stamp(), public.employee_hours_log()
  from public, anon, authenticated;
