import { describe, expect, it } from "vitest";
import { canToggle, filterCounts, groupTasks, isCheckedFor, progress, validateNewTask, type Member, type Task } from "@/lib/tasks";

const R = "r", S = "s", A = "a"; // Роман, Сергій, Саша
const members: Member[] = [
  { id: R, name: "Роман", avatar_letter: "Р", avatar_color: "", can_manage_employees: true, linked: true },
  { id: S, name: "Сергій", avatar_letter: "С", avatar_color: "", can_manage_employees: true, linked: true },
  { id: A, name: "Саша", avatar_letter: "С", avatar_color: "", can_manage_employees: false, linked: true },
];
let n = 0;
function t(p: Partial<Task>): Task {
  n += 1;
  return {
    id: `t${n}`, title: `Задача ${n}`, created_by: R, assignee_kind: "person", assignee_id: A,
    due_date: null, important: false, remind: true, status: "open", done_at: null, done_by: null,
    created_at: `2026-11-01T00:00:${String(n).padStart(2, "0")}Z`, completions: [], ...p,
  };
}
const today = "2026-11-25"; // середа

// Набір як у макеті: 1 прострочена, 3 сьогодні, 2 цього тижня, 2 виконані
const tasks: Task[] = [
  t({ title: "Акт клієнту", assignee_id: A, created_by: S, due_date: "2026-11-22" }),
  t({ title: "Виписки", assignee_id: A, due_date: today }),
  t({ title: "Рахунки", assignee_id: S, created_by: A, due_date: today }),
  t({ title: "Передзвонити", assignee_id: R, created_by: S, due_date: today }),
  t({ title: "Зарплатні", assignee_kind: "all", assignee_id: null, created_by: A, due_date: "2026-11-28", completions: [R] }),
  t({ title: "DPH", assignee_id: A, due_date: "2026-11-29" }),
  t({ title: "Аванси", assignee_id: A, status: "done", done_at: "2026-11-20T10:00:00Z" }),
  t({ title: "Оренда", assignee_id: S, status: "done", done_at: "2026-11-21T10:00:00Z" }),
  t({ title: "Наступного місяця", assignee_id: R, due_date: "2026-12-15" }),
];

describe("розділи задач", () => {
  it("розкладає по розділах як у макеті", () => {
    const s = groupTasks(tasks, "all", R, today);
    expect(s.map((x) => [x.key, x.tasks.length])).toEqual([
      ["overdue", 1], ["today", 3], ["week", 2], ["later", 1], ["done", 2],
    ]);
  });

  it("«Важливо» йде вгору розділу", () => {
    const list = [t({ title: "звичайна", due_date: today }), t({ title: "важлива", due_date: today, important: true })];
    expect(groupTasks(list, "all", R, today)[0].tasks[0].title).toBe("важлива");
  });

  it("виконані: свіжіші зверху", () => {
    const done = groupTasks(tasks, "all", R, today).find((x) => x.key === "done")!;
    expect(done.tasks.map((x) => x.title)).toEqual(["Оренда", "Аванси"]);
  });

  it("фільтри і лічильники (лише невиконані)", () => {
    const c = filterCounts(tasks, members, R);
    expect(c.all).toBe(7);
    expect(c.mine).toBe(3); // Передзвонити, Зарплатні (Усі), Наступного місяця
    expect(c[A]).toBe(4); // Акт, Виписки, Зарплатні, DPH
    expect(c[S]).toBe(2); // Рахунки, Зарплатні
  });

  it("смуга «виконано N з M» рахує відфільтровані", () => {
    expect(progress(tasks, "all", R)).toEqual({ done: 2, total: 9 });
    expect(progress(tasks, S, R)).toEqual({ done: 1, total: 3 });
  });
});

describe("галочка", () => {
  it("закрити може лише виконавець", () => {
    const x = t({ assignee_id: A });
    expect(canToggle(x, A)).toBe(true);
    expect(canToggle(x, R)).toBe(false);
    expect(canToggle(x, S)).toBe(false);
  });

  it("задача «Усі»: кожен ставить свою галочку", () => {
    const x = t({ assignee_kind: "all", assignee_id: null, completions: [R] });
    expect(canToggle(x, S)).toBe(true);
    expect(isCheckedFor(x, R)).toBe(true);
    expect(isCheckedFor(x, S)).toBe(false);
  });
});

describe("форма «Нова задача»", () => {
  const ids = [R, S, A];
  it("приймає правильні дані і обрізає пробіли", () => {
    const r = validateNewTask({ title: "  Надіслати виписки  ", assignee: A, due_date: "2026-11-27", important: true }, ids);
    expect(r).toEqual({ ok: true, value: { title: "Надіслати виписки", assignee: A, due_date: "2026-11-27", important: true, remind: true } });
  });
  it("«Усі» і без терміну", () => {
    const r = validateNewTask({ title: "x", assignee: "all", due_date: null, remind: false }, ids);
    expect(r.ok && r.value.assignee === "all" && r.value.due_date === null && r.value.remind === false).toBe(true);
  });
  it("відхиляє порожній текст, чужого виконавця, криву дату", () => {
    expect(validateNewTask({ title: " ", assignee: A }, ids)).toMatchObject({ ok: false });
    expect(validateNewTask({ title: "x", assignee: "hacker" }, ids)).toMatchObject({ ok: false });
    expect(validateNewTask({ title: "x", assignee: A, due_date: "25.11.2026" }, ids)).toMatchObject({ ok: false });
    expect(validateNewTask({ title: "x".repeat(501), assignee: A }, ids)).toMatchObject({ ok: false });
  });
});
