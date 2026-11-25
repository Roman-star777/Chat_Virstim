-- Змінювати налаштування можуть лише Роман і Сергій. Додаємо перевірку тригером (нічого не видаляючи).
create or replace function public.settings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.current_member_id() is not null and not public.can_manage_employees() then
    raise exception 'Налаштування можуть змінювати лише Роман і Сергій' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger settings_guard before update on public.settings
  for each row execute function public.settings_guard();
revoke execute on function public.settings_guard() from public, anon, authenticated;
