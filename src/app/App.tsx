"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assigneeLabel, canToggle, filterCounts, groupTasks, isCheckedFor, progress,
  type Filter, type Member, type Task,
} from "@/lib/tasks";
import { addDays, dueLabel, longDate, nextFriday } from "@/lib/dates";
import {
  CONTRACT_TYPES, formatDateTime, hoursLabel, isMonth, monthLabel, parseHours, shiftMonth, type Employee,
} from "@/lib/employees";

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------
type TgWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  HapticFeedback?: { impactOccurred: (s: string) => void; notificationOccurred: (s: string) => void };
  BackButton?: { show: () => void; hide: () => void; onClick: (f: () => void) => void; offClick: (f: () => void) => void };
  showConfirm?: (msg: string, cb: (ok: boolean) => void) => void;
  openLink?: (url: string) => void;
  downloadFile?: (p: { url: string; file_name: string }, cb?: (ok: boolean) => void) => void;
  isVersionAtLeast?: (v: string) => boolean;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
};
function tg(): TgWebApp | undefined {
  return (globalThis as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
}
function haptic() {
  tg()?.HapticFeedback?.impactOccurred("light");
}
function confirmAsk(msg: string): Promise<boolean> {
  const w = tg();
  if (w?.showConfirm && w.isVersionAtLeast?.("6.2")) return new Promise((r) => w.showConfirm!(msg, r));
  return Promise.resolve(window.confirm(msg));
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
function makeApi(token: string): Api {
  return async <T,>(path: string, init: RequestInit = {}) => {
    const res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Помилка ${res.status}`);
    return body as T;
  };
}

type AccessRequest = { id: string; tg_first_name: string | null; tg_last_name: string | null; tg_username: string | null };
type Boot = { meId: string; today: string; members: Member[]; tasks: Task[]; accessRequests: AccessRequest[] };

// ---------------------------------------------------------------------------
// Корінь
// ---------------------------------------------------------------------------
export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [boot, setBoot] = useState<Boot | null>(null);
  const [tab, setTab] = useState<"tasks" | "docs" | "employees">("tasks");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const w = tg();
    w?.ready();
    w?.expand();
    try {
      if (w?.isVersionAtLeast?.("6.1")) { w.setHeaderColor?.("#f3f5f7"); w.setBackgroundColor?.("#f3f5f7"); }
    } catch { /* старий Telegram — лишаємо його кольори */ }
    const initData = w?.initData ?? "";
    if (!initData) {
      setFatal("Відкрийте цю сторінку через бота в Telegram.");
      return;
    }
    fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData }) })
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error ?? "Не вдалося увійти");
        setToken(b.token);
      })
      .catch((e: Error) => setFatal(e.message));
  }, []);

  const api = useMemo(() => (token ? makeApi(token) : null), [token]);

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      setBoot(await api<Boot>("/api/bootstrap"));
    } catch (e) {
      setFatal((e as Error).message);
    }
  }, [api]);

  useEffect(() => { void reload(); }, [reload]);

  if (fatal) return <div className="app"><div className="center">{fatal}</div></div>;
  if (!api || !boot) return <div className="app"><div className="center">Завантаження…</div></div>;

  return (
    <div className="app">
      {creating ? (
        <NewTask
          api={api}
          boot={boot}
          onClose={() => setCreating(false)}
          onCreated={(t) => { setBoot({ ...boot, tasks: [...boot.tasks, t] }); setCreating(false); }}
        />
      ) : tab === "tasks" ? (
        <Tasks api={api} boot={boot} setBoot={setBoot} onNew={() => setCreating(true)} reload={reload} />
      ) : tab === "docs" ? (
        <Documents />
      ) : (
        <Employees api={api} />
      )}
      {!creating && (
        <nav className="tabs">
          <button className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}><span className="ic">☑</span>Задачі</button>
          <button className={tab === "docs" ? "on" : ""} onClick={() => setTab("docs")}><span className="ic">📄</span>Документи</button>
          <button className={tab === "employees" ? "on" : ""} onClick={() => setTab("employees")}><span className="ic">👥</span>Працівники</button>
        </nav>
      )}
    </div>
  );
}

function Avatar({ m }: { m?: Member }) {
  if (!m) return <span className="av" style={{ background: "#9aa3b5" }}>У</span>;
  return <span className="av" style={{ background: m.avatar_color }}>{m.avatar_letter}</span>;
}

// ---------------------------------------------------------------------------
// Задачі
// ---------------------------------------------------------------------------
function Tasks({ api, boot, setBoot, onNew, reload }: {
  api: Api; boot: Boot; setBoot: (b: Boot) => void; onNew: () => void; reload: () => Promise<void>;
}) {
  const { meId, members, tasks, today } = boot;
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const me = members.find((m) => m.id === meId);

  const counts = filterCounts(tasks, members, meId);
  const sections = groupTasks(tasks, filter, meId, today);
  const prog = progress(tasks, filter, meId);
  const byId = (id: string | null) => members.find((m) => m.id === id);

  async function toggle(t: Task) {
    if (!canToggle(t, meId) || busy) return;
    haptic();
    setBusy(t.id);
    setError(null);
    try {
      const { task } = await api<{ task: Task }>(`/api/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !isCheckedFor(t, meId) }),
      });
      setBoot({ ...boot, tasks: boot.tasks.map((x) => (x.id === t.id ? task : x)) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(t: Task) {
    if (!(await confirmAsk(`Видалити задачу «${t.title}»?`))) return;
    try {
      await api(`/api/tasks/${t.id}`, { method: "DELETE" });
      setBoot({ ...boot, tasks: boot.tasks.filter((x) => x.id !== t.id) });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "Усі" },
    { key: "mine", label: "Мої" },
    ...members.filter((m) => m.id !== meId).map((m) => ({ key: m.id, label: m.name })),
  ];

  return (
    <>
      <h1>Задачі фірми</h1>
      <div className="sub">{longDate(today)}{me ? ` · ви: ${me.name}` : ""}</div>

      {me?.can_manage_employees && boot.accessRequests.length > 0 && (
        <AccessRequests api={api} members={members} requests={boot.accessRequests} onDone={reload} />
      )}

      <div className="card progress">
        <div className="row"><span>Виконано</span><b style={{ color: "var(--text)" }}>{prog.done} з {prog.total}</b></div>
        <div className="bar"><div style={{ width: prog.total ? `${(100 * prog.done) / prog.total}%` : 0 }} /></div>
      </div>

      <div className="chips">
        {filters.map((f) => (
          <button key={f.key} className={`chip ${filter === f.key ? "on" : ""}`} onClick={() => setFilter(f.key)}>
            {f.label} <span className="n">{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      {sections.length === 0 && <div className="center" style={{ minHeight: "30vh" }}>Задач немає. Натисніть «+», щоб додати.</div>}

      {sections.map((s) => (
        <div key={s.key} className={`section ${s.key}`}>
          <h2>{s.title} · {s.tasks.length}</h2>
          {s.tasks.map((t) => {
            const checked = isCheckedFor(t, meId);
            const allowed = canToggle(t, meId);
            const assignee = t.assignee_kind === "all" ? undefined : byId(t.assignee_id);
            return (
              <div key={t.id} className={`task ${t.status === "done" ? "isdone" : ""}`}>
                <button
                  className={`check ${checked ? "on" : ""}`}
                  disabled={!allowed || busy === t.id}
                  onClick={() => toggle(t)}
                  aria-label={checked ? "Зняти позначку" : "Позначити виконаною"}
                  title={allowed ? "" : "Закрити задачу може лише виконавець"}
                >
                  <span>{checked ? "✓" : ""}</span>
                </button>
                <div className="body">
                  <div className="title">{t.title}</div>
                  <div className="meta">
                    {t.important && t.status === "open" && <span className="badge">Важливо</span>}
                    <Avatar m={assignee} />
                    <span className="who">{assigneeLabel(t, members)}</span>
                    {t.assignee_kind === "all" && t.status === "open" && <span>· {t.completions.length} з {members.length} відмітили</span>}
                    <span>· {t.status === "done" ? "готово" : dueLabel(t.due_date, today)}</span>
                    <span>· від {byId(t.created_by)?.name ?? "?"}</span>
                  </div>
                </div>
                {t.created_by === meId && (
                  <button className="more" onClick={() => remove(t)} aria-label="Видалити задачу">🗑</button>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <button className="fab" onClick={onNew} aria-label="Нова задача">+</button>
    </>
  );
}

function AccessRequests({ api, members, requests, onDone }: {
  api: Api; members: Member[]; requests: AccessRequest[]; onDone: () => Promise<void>;
}) {
  const free = members.filter((m) => !m.linked);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject") {
    setError(null);
    try {
      await api(`/api/access-requests/${id}`, { method: "POST", body: JSON.stringify({ action, memberId: pick[id] }) });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <b>Запити на доступ</b>
      {requests.map((r) => {
        const who = [r.tg_first_name, r.tg_last_name].filter(Boolean).join(" ") || "Без імені";
        return (
          <div key={r.id} style={{ marginTop: 10 }}>
            <div>{who}{r.tg_username ? ` (@${r.tg_username})` : ""}</div>
            <div className="row2">
              <select value={pick[r.id] ?? ""} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}>
                <option value="">Це хто?</option>
                {free.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <button className="secondary" disabled={!pick[r.id]} onClick={() => act(r.id, "approve")}>Пустити</button>
              <button className="secondary danger" onClick={() => act(r.id, "reject")}>Відмовити</button>
            </div>
          </div>
        );
      })}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Нова задача
// ---------------------------------------------------------------------------
function NewTask({ api, boot, onClose, onCreated }: {
  api: Api; boot: Boot; onClose: () => void; onCreated: (t: Task) => void;
}) {
  const { members, today } = boot;
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<string>("");
  const [dueMode, setDueMode] = useState<"today" | "tomorrow" | "friday" | "date" | "none">("tomorrow");
  const [customDate, setCustomDate] = useState("");
  const [important, setImportant] = useState(false);
  const [remind, setRemind] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const b = tg()?.BackButton;
    if (!b) return;
    b.show();
    b.onClick(onClose);
    return () => { b.offClick(onClose); b.hide(); };
  }, [onClose]);

  const due =
    dueMode === "today" ? today
    : dueMode === "tomorrow" ? addDays(today, 1)
    : dueMode === "friday" ? nextFriday(today)
    : dueMode === "date" ? customDate || null
    : null;

  const assigneeName = assignee === "all" ? "Усі" : members.find((m) => m.id === assignee)?.name;

  async function save() {
    setError(null);
    if (!title.trim()) return setError("Напишіть, що треба зробити");
    if (!assignee) return setError("Оберіть, хто виконує");
    if (dueMode === "date" && !customDate) return setError("Оберіть дату");
    setSaving(true);
    try {
      const { task } = await api<{ task: Task }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title, assignee, due_date: due, important, remind }),
      });
      tg()?.HapticFeedback?.notificationOccurred("success");
      onCreated(task);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <button className="back" onClick={onClose} aria-label="Назад">‹</button>
        <h1>Нова задача</h1>
      </div>

      <div className="label">Що треба зробити</div>
      <textarea value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} placeholder="Наприклад: надіслати банківські виписки за листопад" />

      <div className="label">Хто виконує</div>
      <div className="chips wrap">
        {members.map((m) => (
          <button key={m.id} className={`chip ${assignee === m.id ? "on" : ""}`} onClick={() => setAssignee(m.id)}>
            <Avatar m={m} /> {m.name}
          </button>
        ))}
        <button className={`chip ${assignee === "all" ? "on" : ""}`} onClick={() => setAssignee("all")}>
          <span className="av" style={{ background: "#4cc38a" }}>У</span> Усі
        </button>
      </div>
      {assignee === "all" && <div className="note">Задача «Усі» буде виконана, коли галочку поставлять усі троє.</div>}

      <div className="label">Термін</div>
      <div className="chips wrap">
        {([["today", "Сьогодні"], ["tomorrow", "Завтра"], ["friday", "Пʼятниця"], ["date", "Обрати дату"], ["none", "Без терміну"]] as const).map(([k, l]) => (
          <button key={k} className={`chip ${dueMode === k ? "on" : ""}`} onClick={() => setDueMode(k)}>{l}</button>
        ))}
      </div>
      {dueMode === "date" && <input type="date" min={today} value={customDate} onChange={(e) => setCustomDate(e.target.value)} style={{ marginTop: 8 }} />}

      <div className="card" style={{ marginTop: 18 }}>
        <div className="toggle">
          <div>Важливо<small>Піде вгору списку</small></div>
          <button className={`switch ${important ? "on" : ""}`} onClick={() => setImportant(!important)} aria-pressed={important} aria-label="Важливо" />
        </div>
        <div className="toggle">
          <div>Нагадати в Telegram<small>Бот нагадає виконавцю (запрацює на кроці 3)</small></div>
          <button className={`switch ${remind ? "on" : ""}`} onClick={() => setRemind(!remind)} aria-pressed={remind} aria-label="Нагадати в Telegram" />
        </div>
      </div>

      <div className="label">Документ до задачі</div>
      <div className="card note">Прикріплення документів зʼявиться разом із розділом «Документи» (крок 4).</div>

      {error && <div className="error">{error}</div>}
      <button className="primary" disabled={saving} onClick={save}>
        {saving ? "Зберігаю…" : assigneeName ? `Створити: ${assigneeName}` : "Створити"}
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Документи (крок 4)
// ---------------------------------------------------------------------------
function Documents() {
  return (
    <>
      <h1>Документи</h1>
      <div className="sub">Усе з чату в одному місці</div>
      <div className="center" style={{ minHeight: "40vh" }}>
        Цей розділ запрацює на кроці 4: бот збиратиме файли з чату, а ШІ розкладатиме їх за категоріями.
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Працівники
// ---------------------------------------------------------------------------
type EmpData = {
  employees: Employee[];
  lastChange: { by: string | null; at: string } | null;
  canManage: boolean;
  month: string;
  monthsWithHours: string[];
};
type Change = { id: number; changed_by_name: string | null; changed_at: string; action: string; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null };

const FIELD_NAMES: Record<string, string> = { full_name: "імʼя", contract_type: "договір", hours: "години", hours_unit: "одиниця годин", active: "активний" };
const ACTIONS: Record<string, string> = { create: "додав(ла)", update: "змінив(ла)", deactivate: "прибрав(ла)", reactivate: "повернув(ла)", import: "початковий імпорт" };

function describeChange(c: Change): string {
  if (c.action === "hours" && c.new_values) {
    const m = String(c.new_values.month ?? "");
    const fmt = (v: unknown) => (v === null || v === undefined ? "—" : hoursLabel(Number(v)));
    return `години за ${isMonth(m) ? monthLabel(m).toLowerCase() : m}: ${fmt(c.old_values?.hours)} → ${fmt(c.new_values.hours)}`;
  }
  if (c.action !== "update" || !c.old_values || !c.new_values) return ACTIONS[c.action] ?? c.action;
  const parts = Object.keys(c.new_values)
    .filter((k) => JSON.stringify(c.old_values![k]) !== JSON.stringify(c.new_values![k]))
    .map((k) => `${FIELD_NAMES[k] ?? k}: ${c.old_values![k] ?? "—"} → ${c.new_values![k] ?? "—"}`);
  return `змінив(ла) ${parts.join(", ")}`;
}

function Employees({ api }: { api: Api }) {
  const [data, setData] = useState<EmpData | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [history, setHistory] = useState<{ id: string; changes: Change[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async (m: string | null) => {
    try {
      const d = await api<EmpData>(`/api/employees${m ? `?month=${m}` : ""}`);
      setData(d);
      setMonth(d.month);
    } catch (e) { setError((e as Error).message); }
  }, [api]);
  useEffect(() => { void load(null); }, [load]);

  function go(by: number) {
    if (!month) return;
    setPicking(null);
    setHistory(null);
    setError(null);
    void load(shiftMonth(month, by));
  }

  async function setContract(e: Employee, contract_type: string) {
    setPicking(null);
    if (contract_type === e.contract_type) return;
    setError(null);
    haptic();
    setData((d) => d && { ...d, employees: d.employees.map((x) => (x.id === e.id ? { ...x, contract_type } : x)) });
    try {
      await api(`/api/employees/${e.id}`, { method: "PATCH", body: JSON.stringify({ contract_type }) });
    } catch (err) { setError((err as Error).message); }
    await load(month);
  }

  async function saveHours(e: Employee, raw: string) {
    const v = parseHours(raw);
    if (!v.ok) { setError(v.error); return; }
    if (v.value === e.hours) return;
    setError(null);
    setData((d) => d && { ...d, employees: d.employees.map((x) => (x.id === e.id ? { ...x, hours: v.value } : x)) });
    try {
      await api(`/api/employees/${e.id}/hours`, { method: "PUT", body: JSON.stringify({ month, hours: v.value }) });
    } catch (err) { setError((err as Error).message); }
    await load(month);
  }

  async function remove(e: Employee) {
    if (!(await confirmAsk(`Видалити «${e.full_name}» зі списку? Історія змін збережеться.`))) return;
    setError(null);
    try {
      await api(`/api/employees/${e.id}`, { method: "PATCH", body: JSON.stringify({ active: false }) });
    } catch (err) { setError((err as Error).message); }
    await load(month);
  }

  async function toggleHistory(id: string) {
    if (history?.id === id) return setHistory(null);
    try {
      const { changes } = await api<{ changes: Change[] }>(`/api/employees/${id}`);
      setHistory({ id, changes });
    } catch (e) { setError((e as Error).message); }
  }

  async function downloadPdf() {
    if (!month) return;
    setPdfBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/api/employees/pdf-link", { method: "POST", body: JSON.stringify({ month }) });
      const w = tg();
      const name = `pracivnyky-${month}.pdf`;
      if (w?.downloadFile && w.isVersionAtLeast?.("8.0")) w.downloadFile({ url, file_name: name });
      else if (w?.openLink) w.openLink(url);
      else window.open(url, "_blank");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  if (!data || !month) return <div className="center">{error ?? "Завантаження…"}</div>;
  const list = data.employees;
  const total = list.reduce((s, e) => s + (e.hours ?? 0), 0);
  const withHours = list.filter((e) => e.hours !== null).length;

  return (
    <>
      <div className="head">
        <div>
          <h1>Працівники</h1>
          <div className="sub">
            {data.lastChange
              ? `Остання зміна: ${data.lastChange.by ?? "система"}, ${formatDateTime(data.lastChange.at)}`
              : "Змін ще не було"}
          </div>
        </div>
        <button className="pill-btn" onClick={downloadPdf} disabled={pdfBusy}>{pdfBusy ? "…" : "PDF"}</button>
      </div>

      <div className="months">
        <button className="mnav" onClick={() => go(-1)} aria-label="Попередній місяць">‹</button>
        <div className="mcur">{monthLabel(month)}</div>
        <button className="mnav" onClick={() => go(1)} aria-label="Наступний місяць">›</button>
      </div>
      {data.monthsWithHours.length > 1 && (
        <div className="chips">
          {data.monthsWithHours.slice(0, 6).map((m) => (
            <button key={m} className={`chip${m === month ? " on" : ""}`} onClick={() => { setPicking(null); setHistory(null); void load(m); }}>
              {monthLabel(m)}
            </button>
          ))}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <div className="elist">
        <div className="erow ehead">
          <span className="ename">Імʼя</span>
          <span className="etype">Договір</span>
          <span className="ehours">Год.</span>
          {data.canManage && <span className="edel" />}
        </div>
        {list.length === 0 && <div className="note" style={{ padding: "16px 0" }}>Список порожній.</div>}
        {list.map((e) => (
          <div key={e.id} className="eitem">
            <div className="erow">
              <button className="ename" onClick={() => toggleHistory(e.id)}>{e.full_name}</button>
              <button className={`etype tpill${picking === e.id ? " open" : ""}`} onClick={() => setPicking(picking === e.id ? null : e.id)}>
                {e.contract_type}
              </button>
              {data.canManage ? (
                <HoursInput key={`${e.id}-${month}-${e.hours}`} value={e.hours} onSave={(v) => saveHours(e, v)} />
              ) : (
                <span className="ehours">{hoursLabel(e.hours)}</span>
              )}
              {data.canManage && (
                <button className="edel" onClick={() => remove(e)} aria-label="Видалити">✕</button>
              )}
            </div>
            {picking === e.id && (
              <div className="tpick">
                {CONTRACT_TYPES.map((c) => (
                  <button key={c} className={`chip${c === e.contract_type ? " on" : ""}`} onClick={() => setContract(e, c)}>{c}</button>
                ))}
              </div>
            )}
            {history?.id === e.id && (
              <div className="hist">
                {history.changes.length === 0 && <div>Змін ще не було</div>}
                {history.changes.slice(0, 8).map((c) => (
                  <div key={c.id}>{formatDateTime(c.changed_at)} · {c.changed_by_name ?? "система"} {describeChange(c)}</div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="etotal">
          <span>Усього: {list.length}</span>
          <span>{withHours > 0 ? `${hoursLabel(Math.round(total * 100) / 100)} год` : "годин за цей місяць ще немає"}</span>
        </div>
      </div>

      {data.canManage && (adding ? (
        <AddEmployee
          month={month}
          onCancel={() => setAdding(false)}
          onSave={async (v) => { await api("/api/employees", { method: "POST", body: JSON.stringify(v) }); setAdding(false); await load(month); }}
        />
      ) : (
        <button className="add-btn" onClick={() => setAdding(true)}>+ Додати працівника</button>
      ))}
      {!data.canManage && <div className="note" style={{ marginTop: 10 }}>Ви можете змінювати тип договору. Години, додавання і видалення — у Романа і Сергія.</div>}
    </>
  );
}

function HoursInput({ value, onSave }: { value: number | null; onSave: (v: string) => void }) {
  const [v, setV] = useState(value === null ? "" : hoursLabel(value));
  return (
    <input
      className="ehours hin"
      type="text"
      inputMode="decimal"
      placeholder="—"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onSave(v)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function AddEmployee({ month, onSave, onCancel }: {
  month: string;
  onSave: (v: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [contract, setContract] = useState<string>("DPČ");
  const [hours, setHours] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      await onSave({ full_name: fullName, contract_type: contract, hours, month });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="card addcard">
      <input type="text" placeholder="Імʼя і прізвище" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      <div className="addrow">
        <div className="tpick" style={{ padding: 0 }}>
          {CONTRACT_TYPES.map((c) => (
            <button key={c} className={`chip${c === contract ? " on" : ""}`} onClick={() => setContract(c)}>{c}</button>
          ))}
        </div>
        <input type="text" inputMode="decimal" placeholder={`год. (${monthLabel(month).split(" ")[0].toLowerCase()})`} value={hours} onChange={(e) => setHours(e.target.value)} />
      </div>
      {error && <div className="error">{error}</div>}
      <div className="addrow">
        <button className="secondary" onClick={onCancel}>Скасувати</button>
        <button className="pill-btn wide" disabled={saving} onClick={submit}>{saving ? "Зберігаю…" : "Додати"}</button>
      </div>
    </div>
  );
}
