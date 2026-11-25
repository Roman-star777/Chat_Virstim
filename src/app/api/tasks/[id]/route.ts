import { NextResponse } from "next/server";
import { requireSession, dbError, jsonError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

/** Галочка. Звичайна задача: змінює статус (база пускає лише виконавця). «Усі»: ставить/знімає свою галочку. */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const { db, session } = auth;
  const { id } = await ctx.params;

  let done: unknown;
  try { done = (await req.json())?.done; } catch { return jsonError(400, "Неправильний запит"); }
  if (typeof done !== "boolean") return jsonError(400, "Неправильний запит");

  const { data: task, error } = await db.from("tasks").select("id, assignee_kind").eq("id", id).maybeSingle();
  if (error) return dbError(error);
  if (!task) return jsonError(404, "Задачу не знайдено");

  if (task.assignee_kind === "all") {
    const r = done
      ? await db.from("task_completions").upsert({ task_id: id, member_id: session.memberId }, { ignoreDuplicates: true })
      : await db.from("task_completions").delete().eq("task_id", id).eq("member_id", session.memberId);
    if (r.error) return dbError(r.error);
  } else {
    const r = await db.from("tasks").update({ status: done ? "done" : "open" }).eq("id", id);
    if (r.error) return dbError(r.error);
  }

  const [{ data: fresh, error: e2 }, { data: comps, error: e3 }] = await Promise.all([
    db.from("tasks").select("*").eq("id", id).single(),
    db.from("task_completions").select("member_id").eq("task_id", id),
  ]);
  if (e2 || e3) return dbError(e2 ?? e3);
  return NextResponse.json({ task: { ...fresh, completions: (comps ?? []).map((c) => c.member_id) } });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  const { data, error } = await auth.db.from("tasks").delete().eq("id", id).select("id");
  if (error) return dbError(error);
  if (!data?.length) return jsonError(403, "Видалити задачу може лише її автор");
  return NextResponse.json({ ok: true });
}
