import { NextResponse } from "next/server";
import { requireSession, dbError, jsonError } from "@/lib/api";
import { validateEmployee } from "@/lib/employees";

type Ctx = { params: Promise<{ id: string }> };

/** Зміна працівника. Хто що може міняти, перевіряє база (Саша — лише тип договору). */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, "Неправильний запит"); }
  const v = validateEmployee(body, true);
  if (!v.ok) return jsonError(400, v.error);
  const { data, error } = await auth.db.from("employees").update(v.value).eq("id", id).select("id");
  if (error) return dbError(error);
  if (!data?.length) return jsonError(404, "Працівника не знайдено");
  return NextResponse.json({ ok: true });
}

/** Історія змін одного працівника. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  const [ch, members] = await Promise.all([
    auth.db.from("employee_changes").select("id, changed_by, changed_at, action, old_values, new_values").eq("employee_id", id).order("changed_at", { ascending: false }).limit(50),
    auth.db.from("members").select("id, name"),
  ]);
  if (ch.error || members.error) return dbError(ch.error ?? members.error);
  const names = new Map((members.data ?? []).map((m) => [m.id, m.name]));
  return NextResponse.json({
    changes: (ch.data ?? []).map((c) => ({ ...c, changed_by_name: c.changed_by ? names.get(c.changed_by) ?? null : null })),
  });
}
