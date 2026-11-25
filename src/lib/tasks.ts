import { endOfWeek, todayInTz } from "./dates";

export type Member = {
  id: string;
  name: string;
  avatar_letter: string;
  avatar_color: string;
  can_manage_employees: boolean;
  linked: boolean;
};

export type Task = {
  id: string;
  title: string;
  created_by: string;
  assignee_kind: "person" | "all";
  assignee_id: string | null;
  due_date: string | null;
  important: boolean;
  remind: boolean;
  status: "open" | "done";
  done_at: string | null;
  done_by: string | null;
  created_at: string;
  completions: string[]; // member_id тих, хто відмітив задачу «Усі»
};

export type Filter = "all" | "mine" | string; // string = member_id

export type SectionKey = "overdue" | "today" | "week" | "later" | "done";

export const SECTION_TITLES: Record<SectionKey, string> = {
  overdue: "Прострочено",
  today: "Сьогодні",
  week: "Цього тижня",
  later: "Пізніше і без терміну",
  done: "Виконано",
};

/** Чи стосується задача людини: її власна або «Усі». */
export function concerns(task: Task, memberId: string): boolean {
  return task.assignee_kind === "all" || task.assignee_id === memberId;
}

export function matchesFilter(task: Task, filter: Filter, meId: string): boolean {
  if (filter === "all") return true;
  if (filter === "mine") return concerns(task, meId);
  return concerns(task, filter);
}

export function sectionOf(task: Task, today: string): SectionKey {
  if (task.status === "done") return "done";
  if (!task.due_date) return "later";
  if (task.due_date < today) return "overdue";
  if (task.due_date === today) return "today";
  if (task.due_date <= endOfWeek(today)) return "week";
  return "later";
}

/** Порядок у розділі: спершу «Важливо», потім за терміном, потім за датою створення. */
function compare(a: Task, b: Task): number {
  if (a.status === "done" && b.status === "done") return (b.done_at ?? "").localeCompare(a.done_at ?? "");
  if (a.important !== b.important) return a.important ? -1 : 1;
  const da = a.due_date ?? "9999-12-31";
  const db = b.due_date ?? "9999-12-31";
  if (da !== db) return da.localeCompare(db);
  return a.created_at.localeCompare(b.created_at);
}

export type Sections = { key: SectionKey; title: string; tasks: Task[] }[];

export function groupTasks(tasks: Task[], filter: Filter, meId: string, today: string = todayInTz()): Sections {
  const order: SectionKey[] = ["overdue", "today", "week", "later", "done"];
  const buckets = new Map<SectionKey, Task[]>(order.map((k) => [k, []]));
  for (const t of tasks) {
    if (!matchesFilter(t, filter, meId)) continue;
    buckets.get(sectionOf(t, today))!.push(t);
  }
  return order
    .map((key) => ({ key, title: SECTION_TITLES[key], tasks: buckets.get(key)!.sort(compare) }))
    .filter((s) => s.tasks.length > 0);
}

export function filterCounts(tasks: Task[], members: Member[], meId: string): Record<string, number> {
  const open = tasks.filter((t) => t.status === "open");
  const counts: Record<string, number> = {
    all: open.length,
    mine: open.filter((t) => concerns(t, meId)).length,
  };
  for (const m of members) counts[m.id] = open.filter((t) => concerns(t, m.id)).length;
  return counts;
}

export function progress(tasks: Task[], filter: Filter, meId: string): { done: number; total: number } {
  const list = tasks.filter((t) => matchesFilter(t, filter, meId));
  return { done: list.filter((t) => t.status === "done").length, total: list.length };
}

/** Чи може людина ставити/знімати галочку. Для «Усі» — свою власну галочку. */
export function canToggle(task: Task, meId: string): boolean {
  return task.assignee_kind === "all" || task.assignee_id === meId;
}

/** Чи стоїть галочка з погляду цієї людини. */
export function isCheckedFor(task: Task, meId: string): boolean {
  if (task.assignee_kind === "all") return task.status === "done" || task.completions.includes(meId);
  return task.status === "done";
}

export function assigneeLabel(task: Task, members: Member[]): string {
  if (task.assignee_kind === "all") return "Усі";
  return members.find((m) => m.id === task.assignee_id)?.name ?? "?";
}

export type NewTaskInput = {
  title: string;
  assignee: string; // "all" або member_id
  due_date: string | null;
  important: boolean;
  remind: boolean;
};

/** Перевірка форми «Нова задача» (і на клієнті, і на сервері). */
export function validateNewTask(input: unknown, memberIds: string[]): { ok: true; value: NewTaskInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Порожній запит" };
  const i = input as Record<string, unknown>;
  const title = typeof i.title === "string" ? i.title.trim() : "";
  if (!title) return { ok: false, error: "Напишіть, що треба зробити" };
  if (title.length > 500) return { ok: false, error: "Текст задачі задовгий (до 500 символів)" };
  const assignee = typeof i.assignee === "string" ? i.assignee : "";
  if (assignee !== "all" && !memberIds.includes(assignee)) return { ok: false, error: "Оберіть виконавця" };
  let due: string | null = null;
  if (i.due_date !== null && i.due_date !== undefined && i.due_date !== "") {
    if (typeof i.due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(i.due_date) || Number.isNaN(Date.parse(i.due_date))) {
      return { ok: false, error: "Неправильна дата" };
    }
    due = i.due_date;
  }
  return { ok: true, value: { title, assignee, due_date: due, important: i.important === true, remind: i.remind !== false } };
}
