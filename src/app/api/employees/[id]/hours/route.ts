import { NextResponse } from "next/server";
import { requireSession, dbError, jsonError } from "@/lib/api";
import { isMonth, monthToDate, parseHours } from "@/lib/employees";

type Ctx = { params: Promise<{ id: string }> };

/** Години працівника за місяць: {month: "2026-10", hours: 149.5 | null}. Порожньо = стерти. */
export async function PUT(req: Request, ctx: Ctx) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return jsonError(400, "Неправильний запит"); }
  if (!isMonth(body.month)) return jsonError(400, "Неправильний місяць");
  const h = parseHours(body.hours);
  if (!h.ok) return jsonError(400, h.error);

  const { data: me } = await auth.db.from("members").select("can_manage_employees").eq("id", auth.session.memberId).single();
  if (me?.can_manage_employees !== true) return jsonError(403, "Години можуть змінювати лише Роман і Сергій");

  const month = monthToDate(body.month);
  const q = h.value === null
    ? auth.db.from("employee_hours").delete().eq("employee_id", id).eq("month", month).select("employee_id")
    : auth.db.from("employee_hours").upsert({ employee_id: id, month, hours: h.value }).select("employee_id");
  const { error } = await q;
  if (error) return dbError(error);
  return NextResponse.json({ ok: true, hours: h.value });
}
