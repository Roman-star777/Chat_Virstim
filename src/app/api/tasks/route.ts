import { NextResponse } from "next/server";
import { requireSession, dbError, jsonError } from "@/lib/api";
import { validateNewTask } from "@/lib/tasks";

export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const { db, session } = auth;

  const { data: members, error: mErr } = await db.from("members").select("id").eq("active", true);
  if (mErr) return dbError(mErr);
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, "Неправильний запит"); }
  const v = validateNewTask(body, (members ?? []).map((m) => m.id));
  if (!v.ok) return jsonError(400, v.error);

  const { title, assignee, due_date, important, remind } = v.value;
  const { data, error } = await db
    .from("tasks")
    .insert({
      title,
      created_by: session.memberId,
      assignee_kind: assignee === "all" ? "all" : "person",
      assignee_id: assignee === "all" ? null : assignee,
      due_date,
      important,
      remind,
    })
    .select("*")
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ task: { ...data, completions: [] } }, { status: 201 });
}
