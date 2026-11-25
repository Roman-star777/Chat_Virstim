-- Перевірки прав доступу на справжньому Postgres. Кожна перевірка або проходить, або зупиняє скрипт.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- Помічники (створює postgres, виконують усі)
create function t_as(member_name text) returns void language plpgsql as $$
declare mid uuid;
begin
  if member_name = 'anon' then
    perform set_config('request.jwt.claims', '{}', true);
    execute 'set local role anon';
    return;
  end if;
  if member_name = 'service' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    execute 'set local role service_role';
    return;
  end if;
  if member_name = 'stranger' then
    mid := gen_random_uuid();
  else
    select id into mid from public.members where name = member_name;
  end if;
  perform set_config('request.jwt.claims', json_build_object('member_id', mid)::text, true);
  execute 'set local role authenticated';
end $$;

create function t_fail(stmt text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: мало бути відхилено: %', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok, відхилено: % (%)', label, sqlerrm;
end $$;

create function t_eq(actual anyelement, expected anyelement, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % — очікувалось %, отримано %', label, expected, actual;
  end if;
end $$;

grant execute on function t_as(text), t_fail(text, text) to anon, authenticated, service_role;
grant execute on function t_eq(anyelement, anyelement, text) to anon, authenticated, service_role;

select set_config('t.roman', (select id::text from public.members where name = 'Роман'), false);

-- 1. Анонім нічого не бачить
begin;
select t_as('anon');
select t_fail('select count(*) from public.tasks', 'анонім читає задачі');
rollback;

-- 2. Чужа людина з вигаданим member_id бачить 0 рядків
begin;
select t_as('stranger');
select t_eq((select count(*) from public.members), 0::bigint, 'чужий бачить людей');
select t_fail($$insert into public.tasks (title, created_by, assignee_kind) values ('x', current_setting('t.roman')::uuid, 'all')$$, 'чужий створює задачу від імені Романа');
rollback;

-- 3. Задача для Саші: закрити може лише Саша
begin;
select t_as('Роман');
select t_eq((select count(*) from public.members), 3::bigint, 'Роман бачить 3 людей');
insert into public.tasks (title, created_by, assignee_kind, assignee_id, due_date)
  select 'Надіслати виписки', public.current_member_id(), 'person', (select id from public.members where name = 'Саша'), current_date;
select t_fail($$update public.tasks set status = 'done' where title = 'Надіслати виписки'$$, 'Роман закриває задачу Саші');
select t_fail($$insert into public.tasks (title, created_by, assignee_kind) select 'від чужого імені', id, 'all' from public.members where name = 'Сергій'$$, 'Роман створює задачу від імені Сергія');
select t_as('Сергій');
select t_fail($$update public.tasks set status = 'done' where title = 'Надіслати виписки'$$, 'Сергій закриває задачу Саші');
select t_as('Саша');
select t_fail($$update public.tasks set title = 'інше' where title = 'Надіслати виписки'$$, 'Саша змінює текст чужої задачі');
update public.tasks set status = 'done' where title = 'Надіслати виписки';
select t_eq((select status::text from public.tasks where title = 'Надіслати виписки'), 'done', 'Саша закрила');
select t_eq((select m.name from public.tasks t join public.members m on m.id = t.done_by where t.title = 'Надіслати виписки'), 'Саша', 'хто виконав');
update public.tasks set status = 'open' where title = 'Надіслати виписки';
select t_eq((select done_by from public.tasks where title = 'Надіслати виписки'), null::uuid, 'повернула в невиконані');
rollback;

-- 3б. Видаляти може лише автор (для інших delete просто нічого не знаходить)
begin;
select t_as('Роман');
insert into public.tasks (title, created_by, assignee_kind) values ('Тест видалення', public.current_member_id(), 'all');
select t_as('Саша');
delete from public.tasks where title = 'Тест видалення';
select t_as('Роман');
select t_eq((select count(*) from public.tasks where title = 'Тест видалення'), 1::bigint, 'Саша не видалила задачу Романа');
delete from public.tasks where title = 'Тест видалення';
select t_eq((select count(*) from public.tasks where title = 'Тест видалення'), 0::bigint, 'Роман видалив свою');
rollback;

-- 4. Задача «Усі»: виконана лише після трьох галочок
begin;
select t_as('Роман');
insert into public.tasks (title, created_by, assignee_kind, due_date) values ('Перевірити зарплатні відомості', public.current_member_id(), 'all', current_date);
select t_fail($$update public.tasks set status = 'done' where title = 'Перевірити зарплатні відомості'$$, 'пряме закриття задачі «Усі»');
insert into public.task_completions (task_id, member_id)
  select id, public.current_member_id() from public.tasks where title = 'Перевірити зарплатні відомості';
select t_eq((select status::text from public.tasks where title = 'Перевірити зарплатні відомості'), 'open', '1 з 3');
select t_fail($$insert into public.task_completions (task_id, member_id) select t.id, m.id from public.tasks t, public.members m where t.title = 'Перевірити зарплатні відомості' and m.name = 'Саша'$$, 'Роман ставить галочку за Сашу');
select t_as('Сергій');
insert into public.task_completions (task_id, member_id)
  select id, public.current_member_id() from public.tasks where title = 'Перевірити зарплатні відомості';
select t_eq((select status::text from public.tasks where title = 'Перевірити зарплатні відомості'), 'open', '2 з 3');
select t_as('Саша');
insert into public.task_completions (task_id, member_id)
  select id, public.current_member_id() from public.tasks where title = 'Перевірити зарплатні відомості';
select t_eq((select status::text from public.tasks where title = 'Перевірити зарплатні відомості'), 'done', '3 з 3');
delete from public.task_completions where member_id = public.current_member_id();
select t_eq((select status::text from public.tasks where title = 'Перевірити зарплатні відомості'), 'open', 'Саша зняла галочку');
rollback;

-- 4б. Галочка «Усі» не працює на звичайній задачі
begin;
select t_as('Роман');
insert into public.tasks (title, created_by, assignee_kind, assignee_id) select 'Своя', public.current_member_id(), 'person', public.current_member_id();
select t_fail($$insert into public.task_completions (task_id, member_id) select id, public.current_member_id() from public.tasks where title = 'Своя'$$, 'галочка «Усі» на звичайній задачі');
rollback;

-- 5. Працівники: права і журнал змін
begin;
select t_as('Саша');
select t_fail($$insert into public.employees (full_name, contract_type) values ('Іван Тест', 'HPP')$$, 'Саша додає працівника');
select t_as('Роман');
insert into public.employees (full_name, contract_type) values ('Іван Тест', 'HPP');
select t_eq((select m.name from public.employees e join public.members m on m.id = e.updated_by where e.full_name = 'Іван Тест'), 'Роман', 'хто додав');
select t_eq((select action from public.employee_changes order by id desc limit 1), 'create', 'журнал: create');
select t_fail($$insert into public.employees (full_name, contract_type) values ('Петро Тест', 'IČO')$$, 'тип договору не з трьох');
insert into public.employee_hours (employee_id, month, hours) select id, '2026-11-01', 40 from public.employees where full_name = 'Іван Тест';
select t_eq((select action || ':' || (new_values->>'month') || ':' || (new_values->>'hours') from public.employee_changes order by id desc limit 1), 'update:2026-11:40.00', 'журнал: години за місяць');
select t_fail($$insert into public.employee_hours (employee_id, month, hours) select id, '2026-11-15', 1 from public.employees where full_name = 'Іван Тест'$$, 'місяць не з 1-го числа');
select t_as('Саша');
update public.employees set contract_type = 'DPP' where full_name = 'Іван Тест';
select t_eq((select contract_type from public.employees where full_name = 'Іван Тест'), 'DPP', 'Саша змінила тип договору');
select t_eq((select m.name from public.employees e join public.members m on m.id = e.updated_by where e.full_name = 'Іван Тест'), 'Саша', 'остання зміна: Саша');
select t_eq((select old_values->>'contract_type' || '→' || (new_values->>'contract_type') from public.employee_changes order by id desc limit 1), 'HPP→DPP', 'журнал: що змінилось');
update public.employee_hours set hours = 20 where month = '2026-11-01';  -- Саша: RLS не пропускає (0 рядків)
select t_eq((select hours from public.employee_hours where month = '2026-11-01'), 40.00::numeric, 'години не змінились');
select t_fail($$insert into public.employee_hours (employee_id, month, hours) select id, '2026-12-01', 5 from public.employees where full_name = 'Іван Тест'$$, 'Саша додає години');
delete from public.employee_hours where month = '2026-11-01';
select t_eq((select count(*) from public.employee_hours where month = '2026-11-01'), 1::bigint, 'Саша не може стерти години');
select t_eq((select count(*) from public.employee_hours), 1::bigint, 'Саша бачить години');
select t_fail($$update public.employees set full_name = 'Інше' where full_name = 'Іван Тест'$$, 'Саша змінює імʼя');
select t_fail($$update public.employees set active = false where full_name = 'Іван Тест'$$, 'Саша прибирає працівника');
delete from public.employees where full_name = 'Іван Тест';
select t_eq((select count(*) from public.employees where full_name = 'Іван Тест'), 1::bigint, 'видалення неможливе');
select t_as('Сергій');
update public.employees set active = false where full_name = 'Іван Тест';
select t_eq((select action from public.employee_changes order by id desc limit 1), 'deactivate', 'журнал: deactivate');
select t_eq((select count(*) from public.employee_changes), 4::bigint, 'усього 4 записи в журналі');
update public.employee_hours set hours = 41.5 where month = '2026-11-01';
select t_eq((select old_values->>'hours' || '→' || (new_values->>'hours') from public.employee_changes order by id desc limit 1), '40.00→41.50', 'Сергій змінив години');
delete from public.employee_hours where month = '2026-11-01';
select t_eq((select coalesce(new_values->>'hours', 'порожньо') from public.employee_changes order by id desc limit 1), 'порожньо', 'Сергій стер години');
select t_as('anon');
select t_fail($$select * from public.employee_hours$$, 'анонім читає години');
rollback;

-- 6. Неактивний член команди втрачає доступ
begin;
update public.members set active = false where name = 'Саша';
select t_as('Саша');
select t_eq((select count(*) from public.members), 0::bigint, 'неактивна Саша нічого не бачить');
rollback;

-- 7. Службовий ключ (бот/планувальник) може закрити задачу
begin;
select t_as('Роман');
insert into public.tasks (title, created_by, assignee_kind, assignee_id) select 'Системна', public.current_member_id(), 'person', (select id from public.members where name = 'Саша');
reset role;
select t_as('service');
update public.tasks set status = 'done' where title = 'Системна';
select t_eq((select status::text from public.tasks where title = 'Системна'), 'done', 'службовий ключ');
rollback;

-- 8. Службові секрети не видно нікому з команди
begin;
select t_as('Роман');
select t_fail($$select value from public.internal_secrets$$, 'Роман читає службовий ключ');
reset role;
select t_as('anon');
select t_fail($$select value from public.internal_secrets$$, 'анонім читає службовий ключ');
reset role;
select t_eq((select length(value) from public.internal_secrets where name = 'cron'), 64, 'ключ запуску створено');
rollback;

-- 9. Щомісячний список: один запис на місяць, команда лише читає
begin;
insert into public.monthly_reports (month, chat_id) values ('2026-11-01', -1);
select t_fail($$insert into public.monthly_reports (month, chat_id) values ('2026-11-01', -1)$$, 'вдруге той самий місяць');
select t_as('Роман');
select t_eq((select count(*) from public.monthly_reports), 1::bigint, 'Роман бачить журнал розсилки');
select t_fail($$insert into public.monthly_reports (month, chat_id) values ('2026-12-01', -1)$$, 'Роман пише в журнал розсилки');
rollback;

-- 10. Налаштування міняють лише Роман і Сергій
begin;
select t_as('Саша');
select t_fail($$update public.settings set reminder_hour = 7$$, 'Саша міняє налаштування');
select t_eq((select reminder_hour from public.settings), 9, 'налаштування не змінились');
reset role;
select t_as('Роман');
update public.settings set reminder_hour = 8;
select t_eq((select reminder_hour from public.settings), 8, 'Роман міняє годину нагадувань');
rollback;

select 'усі перевірки прав пройдено' as result;
