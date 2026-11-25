import { NextResponse } from "next/server";
import { requireSession, dbError, jsonError } from "@/lib/api";
import { isMonth, monthToDate, parseHours, validateEmployee } from "@/lib/employees";
import { loadEmployees } from "@/lib/employees-db";
import { resolveMonth } from "@/lib/employees-month";

export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const month = await resolveMonth(auth.db, new URL(req.url).searchParams.get("month"));
  const r = await loadEmployees(auth.db, month);
  if ("error" in r) return dbError(r.error ?? null);
  const { data: me } = await auth.db.from("members").select("can_manage_employees").eq("id", auth.session.memberId).single();
  return NextResponse.json({ ...r, month, canManage: me?.can_manage_employees === true });
}

/** Новий працівник (лише Роман і Сергій — перевіряє база). Години — за вказаний місяць. */
export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return jsonError(400, "Неправильний запит"); }
  const v = validateEmployee(body, false);
  if (!v.ok) return jsonError(400, v.error);
  const h = parseHours(body.hours);
  if (!h.ok) return jsonError(400, h.error);
  if (h.value !== null && !isMonth(body.month)) return jsonError(400, "Не вказано місяць для годин");
  const { data, error } = await auth.db.from("employees").insert(v.value).select("id").single();
  if (error) return dbError(error);
  if (h.value !== null) {
    const r = await auth.db.from("employee_hours").insert({ employee_id: data.id, month: monthToDate(body.month as string), hours: h.value });
    if (r.error) return dbError(r.error);
  }
  return NextResponse.json({ id: data.id }, { status: 201 });
}
