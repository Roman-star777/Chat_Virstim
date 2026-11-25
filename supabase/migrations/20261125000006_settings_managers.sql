-- Змінювати налаштування можуть лише Роман і Сергій (раніше — будь-хто з трьох).
drop policy settings_update on public.settings;
create policy settings_update on public.settings for update to authenticated
  using (public.can_manage_employees()) with check (public.can_manage_employees());
