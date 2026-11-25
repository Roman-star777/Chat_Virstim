import type { SupabaseClient } from "@supabase/supabase-js";
import { monthToDate, type Employee } from "./employees";

/** Активні працівники з годинами за місяць (YYYY-MM) + список місяців, де є години. */
export async function loadEmployees(db: SupabaseClient, month: string) {
  const [emps, hours, months, members, last] = await Promise.all([
    db.from("employees").select("id, full_name, contract_type, active, updated_at, updated_by").eq("active", true).order("full_name"),
    db.from("employee_hours").select("employee_id, hours").eq("month", monthToDate(month)),
    db.from("employee_hours").select("month").order("month", { ascending: false }).limit(1000),
    db.from("members").select("id, name"),
    db.from("employee_changes").select("changed_by, changed_at").order("changed_at", { ascending: false }).limit(1),
  ]);
  const err = emps.error ?? hours.error ?? months.error ?? members.error ?? last.error;
  if (err) return { error: err } as const;
  const names = new Map((members.data ?? []).map((m) => [m.id, m.name as string]));
  const h = new Map((hours.data ?? []).map((r) => [r.employee_id as string, Number(r.hours)]));
  const employees: Employee[] = (emps.data ?? []).map(({ updated_by, ...e }) => ({
    ...e,
    hours: h.get(e.id) ?? null,
    updated_by_name: updated_by ? names.get(updated_by) ?? null : null,
  }));
  const monthsWithHours = [...new Set((months.data ?? []).map((r) => String(r.month).slice(0, 7)))];
  const l = last.data?.[0];
  const lastChange = l ? { by: l.changed_by ? names.get(l.changed_by) ?? null : null, at: l.changed_at as string } : null;
  return { employees, lastChange, monthsWithHours } as const;
}
