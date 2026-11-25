import { addDays, shortDate } from "./dates";

export type ReminderKind = "day_before" | "due_today" | "overdue";

export type RemTask = {
  id: string;
  title: string;
  assignee_kind: "person" | "all";
  assignee_id: string | null;
  due_date: string | null;
  status: "open" | "done";
  remind: boolean;
  important: boolean;
  completions: string[];
};
export type RemMember = { id: string; name: string; tg_user_id: number | null; active: boolean };
export type RemSettings = { remind_day_before: boolean; remind_due_today: boolean; remind_overdue: boolean };

export type Planned = { taskId: string; kind: ReminderKind; forDate: string; memberIds: string[] };

/** Які нагадування треба надіслати сьогодні (без урахування вже надісланих). */
export function planReminders(tasks: RemTask[], members: RemMember[], today: string, s: RemSettings): Planned[] {
  const active = members.filter((m) => m.active);
  const out: Planned[] = [];
  for (const t of tasks) {
    if (t.status !== "open" || !t.remind || !t.due_date) continue;
    let kind: ReminderKind | null = null;
    if (t.due_date === addDays(today, 1) && s.remind_day_before) kind = "day_before";
    else if (t.due_date === today && s.remind_due_today) kind = "due_today";
    else if (t.due_date < today && s.remind_overdue) kind = "overdue";
    if (!kind) continue;
    const memberIds = t.assignee_kind === "person"
      ? active.filter((m) => m.id === t.assignee_id).map((m) => m.id)
      : active.filter((m) => !t.completions.includes(m.id)).map((m) => m.id);
    if (memberIds.length) out.push({ taskId: t.id, kind, forDate: today, memberIds });
  }
  return out;
}

const ORDER: ReminderKind[] = ["overdue", "due_today", "day_before"];
const HEAD: Record<ReminderKind, string> = {
  overdue: "⚠️ Прострочено",
  due_today: "⏰ Сьогодні",
  day_before: "📅 Завтра",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Один лист на людину (HTML для Telegram). */
export function reminderText(items: { task: RemTask; kind: ReminderKind }[], name?: string): string {
  const lines: string[] = [name ? `<b>${esc(name)}</b>, нагадування по задачах:` : "Нагадування по задачах:"];
  for (const k of ORDER) {
    const list = items.filter((i) => i.kind === k);
    if (!list.length) continue;
    lines.push("", `<b>${HEAD[k]}</b>`);
    for (const { task } of list) {
      const extra = k === "overdue" && task.due_date ? ` (термін був ${shortDate(task.due_date)})` : "";
      const all = task.assignee_kind === "all" ? " · для всіх" : "";
      lines.push(`• ${task.important ? "❗ " : ""}${esc(task.title)}${extra}${all}`);
    }
  }
  return lines.join("\n");
}

/** Година за Прагою (0–23). */
export function hourInTz(tz: string, now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now));
}
