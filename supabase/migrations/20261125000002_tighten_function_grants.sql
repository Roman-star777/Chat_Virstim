-- Порада Supabase Security Advisor: функції за замовчуванням виконуються будь-ким (PUBLIC).
-- Тригерні функції не потрібні нікому напряму, допоміжні — лише тим, хто увійшов (для RLS).
revoke execute on function public.tasks_guard(), public.sync_all_task_status(),
  public.employees_guard(), public.employees_log(), public.touch_updated_at()
  from public, anon, authenticated;

revoke execute on function public.current_member_id(), public.is_member(), public.can_manage_employees()
  from public, anon;
grant execute on function public.current_member_id(), public.is_member(), public.can_manage_employees()
  to authenticated, service_role;

alter function public.touch_updated_at() set search_path = public;
