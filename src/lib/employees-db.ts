import type { SupabaseClient } from "@supabase/supabase-js";
import type { Employee } from "./employees";

export async function loadEmployees(db: SupabaseClient) {
  const [emps, members, last] = await Promise.all([
    db.from("employees").select("id, full_name, contract_type, hours, hours_unit, active, updated_at, updated_by").order("full_name"),
    db.from("members").select("id, name"),
    db.from("employee_changes").select("changed_by, changed_at").order("changed_at", { ascending: false }).limit(1),
  ]);
  const err = emps.error ?? members.error ?? last.error;
  if (err) return { error: err } as const;
  const names = new Map((members.data ?? []).map((m) => [m.id, m.name as string]));
  const employees: Employee[] = (emps.data ?? []).map(({ updated_by, ...e }) => ({
    ...e,
    hours: e.hours === null ? null : Number(e.hours),
    updated_by_name: updated_by ? names.get(updated_by) ?? null : null,
  }));
  const l = last.data?.[0];
  const lastChange = l ? { by: l.changed_by ? names.get(l.changed_by) ?? null : null, at: l.changed_at as string } : null;
  return { employees, lastChange } as const;
}
