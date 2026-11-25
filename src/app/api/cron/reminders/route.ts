import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { appUrl, ensureWebhook, tgCall, TgError } from "@/lib/bot";
import { dbService } from "@/lib/supabase";
import { todayInTz } from "@/lib/dates";
import { monthlyReportDue } from "@/lib/monthly";
import { sendMonthlyReportOnce } from "@/lib/monthly-report";
import { hourInTz, planReminders, reminderText, type RemTask, type ReminderKind } from "@/lib/reminders";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Запускається щогодини з Supabase (pg_cron). Ключ запуску лежить у базі (internal_secrets),
 * бачить його лише службовий доступ. О 9:00 за Прагою (або пізніше того ж дня, якщо пропустили)
 * надсилає нагадування; кожне — лише раз (reminder_log).
 */
export async function POST(req: Request) {
  const db = dbService();
  const got = req.headers.get("x-cron-token") ?? "";
  const { data: sec, error: secErr } = await db.from("internal_secrets").select("value").eq("name", "cron").single();
  if (secErr || !sec) return NextResponse.json({ error: "no cron secret" }, { status: 500 });
  const a = Buffer.from(got), b = Buffer.from(sec.value as string);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const report: Record<string, unknown> = {};
  try {
    report.webhook = await ensureWebhook();
  } catch (e) {
    report.webhook = { error: String(e) };
  }

  const { data: s, error: sErr } = await db.from("settings").select("*").single();
  if (sErr) return NextResponse.json({ ...report, error: sErr.message }, { status: 500 });
  const tz = s.timezone as string;
  const hour = hourInTz(tz);
  const today = todayInTz(tz);
  report.hour = hour;
  report.today = today;
  // Щомісячний список працівників у групу (10-го о годині нагадувань)
  const reportMonth = monthlyReportDue(today, hour, s.reminder_hour);
  if (reportMonth && s.group_chat_id) {
    try {
      report.monthly = { month: reportMonth, ...(await sendMonthlyReportOnce(db, reportMonth, s.group_chat_id)) };
    } catch (e) {
      console.error("monthly report failed", e);
      report.monthly = { month: reportMonth, error: String(e) };
    }
  }

  if (hour < s.reminder_hour) return NextResponse.json({ ...report, reminders: "ще не час" });

  const [tasks, completions, members, sent] = await Promise.all([
    db.from("tasks").select("id, title, assignee_kind, assignee_id, due_date, status, remind, important").eq("status", "open").eq("remind", true).not("due_date", "is", null),
    db.from("task_completions").select("task_id, member_id"),
    db.from("members").select("id, name, tg_user_id, active"),
    db.from("reminder_log").select("task_id, kind").eq("for_date", today),
  ]);
  for (const r of [tasks, completions, members, sent]) if (r.error) return NextResponse.json({ ...report, error: r.error.message }, { status: 500 });

  const byTask = new Map<string, string[]>();
  for (const c of completions.data ?? []) byTask.set(c.task_id, [...(byTask.get(c.task_id) ?? []), c.member_id]);
  const list: RemTask[] = (tasks.data ?? []).map((t) => ({ ...t, completions: byTask.get(t.id) ?? [] }));
  const already = new Set((sent.data ?? []).map((r) => `${r.task_id}:${r.kind}`));
  const plan = planReminders(list, members.data ?? [], today, s).filter((p) => !already.has(`${p.taskId}:${p.kind}`));

  // Групуємо: один лист на людину
  const perMember = new Map<string, { task: RemTask; kind: ReminderKind }[]>();
  for (const p of plan) {
    const task = list.find((t) => t.id === p.taskId)!;
    for (const mid of p.memberIds) perMember.set(mid, [...(perMember.get(mid) ?? []), { task, kind: p.kind }]);
  }

  const delivered = new Set<string>(); // task:kind, що дійшли хоча б до однієї людини
  const results: { member: string; via: string; ok: boolean; error?: string }[] = [];
  const groupFallback: { name: string; items: { task: RemTask; kind: ReminderKind }[] }[] = [];
  for (const [mid, items] of perMember) {
    const m = (members.data ?? []).find((x) => x.id === mid)!;
    if (m.tg_user_id) {
      try {
        await tgCall("sendMessage", {
          chat_id: m.tg_user_id, text: reminderText(items), parse_mode: "HTML",
          reply_markup: { inline_keyboard: [[{ text: "Відкрити задачі", web_app: { url: appUrl() } }]] },
        });
        items.forEach((i) => delivered.add(`${i.task.id}:${i.kind}`));
        results.push({ member: m.name, via: "особисто", ok: true });
        continue;
      } catch (e) {
        results.push({ member: m.name, via: "особисто", ok: false, error: e instanceof TgError ? e.description : String(e) });
      }
    }
    groupFallback.push({ name: m.name, items });
  }
  // Хто не відкрив бота особисто — нагадуємо в групі
  if (groupFallback.length && s.group_chat_id) {
    for (const g of groupFallback) {
      try {
        await tgCall("sendMessage", { chat_id: s.group_chat_id, text: reminderText(g.items, g.name), parse_mode: "HTML" });
        g.items.forEach((i) => delivered.add(`${i.task.id}:${i.kind}`));
        results.push({ member: g.name, via: "група", ok: true });
      } catch (e) {
        results.push({ member: g.name, via: "група", ok: false, error: String(e) });
      }
    }
  }

  const rows = [...delivered].map((k) => { const [task_id, kind] = k.split(":"); return { task_id, kind, for_date: today }; });
  if (rows.length) {
    const { error } = await db.from("reminder_log").upsert(rows, { onConflict: "task_id,kind,for_date", ignoreDuplicates: true });
    if (error) report.logError = error.message;
  }
  return NextResponse.json({ ...report, planned: plan.length, results });
}
