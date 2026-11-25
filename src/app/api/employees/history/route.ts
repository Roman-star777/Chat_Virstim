import { NextResponse } from "next/server";
import { requireSession, dbError } from "@/lib/api";

/** Останні зміни по всіх працівниках: хто, коли, що. */
export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const [ch, members, emps] = await Promise.all([
    auth.db.from("employee_changes").select("id, employee_id, changed_by, changed_at, action, old_values, new_values")
      .order("changed_at", { ascending: false }).order("id", { ascending: false }).limit(100),
    auth.db.from("members").select("id, name"),
    auth.db.from("employees").select("id, full_name"),
  ]);
  if (ch.error || members.error || emps.error) return dbError(ch.error ?? members.error ?? emps.error);
  const names = new Map((members.data ?? []).map((m) => [m.id, m.name as string]));
  const people = new Map((emps.data ?? []).map((e) => [e.id, e.full_name as string]));
  return NextResponse.json({
    changes: (ch.data ?? []).map((c) => ({
      ...c,
      changed_by_name: c.changed_by ? names.get(c.changed_by) ?? null : null,
      employee_name: people.get(c.employee_id) ?? "—",
    })),
  });
}
