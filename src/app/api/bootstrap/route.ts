import { NextResponse } from "next/server";
import { requireSession, dbError } from "@/lib/api";
import { todayInTz } from "@/lib/dates";

/** Усе, що потрібно екрану «Задачі»: люди, задачі з галочками, сьогоднішня дата за Прагою. */
export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const { db, session } = auth;

  const [members, tasks, completions, settings, requests] = await Promise.all([
    db.from("members").select("id, name, avatar_letter, avatar_color, can_manage_employees, tg_user_id").eq("active", true).order("created_at"),
    db.from("tasks").select("*").order("created_at"),
    db.from("task_completions").select("task_id, member_id"),
    db.from("settings").select("timezone").single(),
    db.from("access_requests").select("id, tg_first_name, tg_last_name, tg_username, created_at").is("resolved_at", null),
  ]);
  for (const r of [members, tasks, completions, settings, requests]) if (r.error) return dbError(r.error);

  const byTask = new Map<string, string[]>();
  for (const c of completions.data ?? []) byTask.set(c.task_id, [...(byTask.get(c.task_id) ?? []), c.member_id]);

  return NextResponse.json({
    meId: session.memberId,
    today: todayInTz(settings.data?.timezone ?? "Europe/Prague"),
    members: (members.data ?? []).map(({ tg_user_id, ...m }) => ({ ...m, linked: tg_user_id !== null })),
    tasks: (tasks.data ?? []).map((t) => ({ ...t, completions: byTask.get(t.id) ?? [] })),
    accessRequests: requests.data ?? [],
  });
}
