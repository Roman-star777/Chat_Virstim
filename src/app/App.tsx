"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assigneeLabel, canToggle, filterCounts, groupTasks, isCheckedFor, progress,
  type Filter, type Member, type Task,
} from "@/lib/tasks";
import { addDays, dueLabel, longDate, nextFriday } from "@/lib/dates";
import { CONTRACT_TYPES, formatDateTime, hoursLabel, type Employee } from "@/lib/employees";

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
type EmpData = { employees: Employee[]; lastChange: { by: string | null; at: string } | null; canManage: boolean };
type Change = { id: number; changed_by_name: string | null; changed_at: string; action: string; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null };

const FIELD_NAMES: Record<string, string> = { full_name: "імʼя", contract_type: "тип договору", hours: "години", hours_unit: "одиниця годин", active: "активний" };
const ACTIONS: Record<string, string> = { create: "додав(ла)", update: "змінив(ла)", deactivate: "прибрав(ла)", reactivate: "повернув(ла)", import: "початковий імпорт" };

function describeChange(c: Change): string {
  if (c.action !== "update" || !c.old_values || !c.new_values) return ACTIONS[c.action] ?? c.action;
  const parts = Object.keys(c.new_values)
    .filter((k) => JSON.stringify(c.old_values![k]) !== JSON.stringify(c.new_values![k]))
    .map((k) => `${FIELD_NAMES[k] ?? k}: ${c.old_values![k] ?? "—"} → ${c.new_values![k] ?? "—"}`);
  return `змінив(ла) ${parts.join(", ")}`;
}

function Employees({ api }: { api: Api }) {
  const [data, setData] = useState<EmpData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<{ id: string; changes: Change[] } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api<EmpData>("/api/employees")); } catch (e) { setError((e as Error).message); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  async function downloadPdf() {
    setPdfBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/api/employees/pdf-link", { method: "POST" });
      const w = tg();
      const name = `pracivnyky-${new Date().toISOString().slice(0, 10)}.pdf`;
      if (w?.downloadFile && w.isVersionAtLeast?.("8.0")) w.downloadFile({ url, file_name: name });
      else if (w?.openLink) w.openLink(url);
      else window.open(url, "_blank");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  async function showHistory(id: string) {
    if (history?.id === id) return setHistory(null);
    try {
      const { changes } = await api<{ changes: Change[] }>(`/api/employees/${id}`);
      setHistory({ id, changes });
    } catch (e) { setError((e as Error).message); }
  }

  async function deactivate(e: Employee) {
    if (!(await confirmAsk(`Прибрати «${e.full_name}» зі списку? Історія збережеться.`))) return;
    try {
      await api(`/api/employees/${e.id}`, { method: "PATCH", body: JSON.stringify({ active: false }) });
      await load();
    } catch (err) { setError((err as Error).message); }
  }

  if (!data) return <div className="center">{error ?? "Завантаження…"}</div>;
  const active = data.employees.filter((e) => e.active);

  return (
    <>
      <h1>Працівники</h1>
      <div className="sub">
        {data.lastChange
          ? `Остання зміна: ${data.lastChange.by ?? "система"}, ${formatDateTime(data.lastChange.at)}`
          : "Змін ще не було"}
      </div>

      <div className="row2" style={{ marginTop: 12 }}>
        <button className="secondary" onClick={downloadPdf} disabled={pdfBusy}>{pdfBusy ? "Готую PDF…" : "⬇ Скачати PDF"}</button>
        {data.canManage && <button className="secondary" onClick={() => setAdding(!adding)}>+ Додати</button>}
      </div>
      {error && <div className="error">{error}</div>}

      {adding && (
        <EmployeeForm
          canManage
          onCancel={() => setAdding(false)}
          onSave={async (v) => { await api("/api/employees", { method: "POST", body: JSON.stringify(v) }); setAdding(false); await load(); }}
        />
      )}

      {active.length === 0 && <div className="center" style={{ minHeight: "25vh" }}>Список порожній.</div>}
      {active.map((e) => (
        <div key={e.id} className="emp">
          {editing === e.id ? (
            <EmployeeForm
              initial={e}
              canManage={data.canManage}
              onCancel={() => setEditing(null)}
              onSave={async (v) => { await api(`/api/employees/${e.id}`, { method: "PATCH", body: JSON.stringify(v) }); setEditing(null); await load(); }}
            />
          ) : (
            <>
              <div className="name">{e.full_name}</div>
              <div className="meta">
                <span className="who">{e.contract_type}</span>
                <span>· {hoursLabel(e)}</span>
              </div>
              <div className="meta">змінив(ла): {e.updated_by_name ?? "система"}, {formatDateTime(e.updated_at)}</div>
              <div className="row2">
                <button className="secondary" onClick={() => setEditing(e.id)}>{data.canManage ? "Змінити" : "Змінити тип договору"}</button>
                <button className="secondary" onClick={() => showHistory(e.id)}>Історія</button>
                {data.canManage && <button className="secondary danger" onClick={() => deactivate(e)}>Прибрати</button>}
              </div>
              {history?.id === e.id && (
                <div className="hist">
                  {history.changes.map((c) => (
                    <div key={c.id}>{formatDateTime(c.changed_at)} · {c.changed_by_name ?? "система"} {describeChange(c)}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </>
  );
}

function EmployeeForm({ initial, canManage, onSave, onCancel }: {
  initial?: Employee;
  canManage: boolean;
  onSave: (v: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(initial?.full_name ?? "");
  const [contract, setContract] = useState(initial?.contract_type ?? "HPP");
  const [hours, setHours] = useState(initial?.hours?.toString() ?? "");
  const [unit, setUnit] = useState<"week" | "month">(initial?.hours_unit ?? "week");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const options = CONTRACT_TYPES.includes(contract as (typeof CONTRACT_TYPES)[number]) ? CONTRACT_TYPES : [contract, ...CONTRACT_TYPES];

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      const v: Record<string, unknown> = canManage
        ? { full_name: fullName, contract_type: contract, hours: hours === "" ? null : hours, hours_unit: unit }
        : { contract_type: contract };
      await onSave(v);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 10 }}>
      {canManage && (
        <>
          <div className="label" style={{ marginTop: 0 }}>Імʼя і прізвище</div>
          <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </>
      )}
      {!canManage && <div className="name">{initial?.full_name}</div>}
      <div className="label">Тип договору</div>
      <select value={contract} onChange={(e) => setContract(e.target.value)}>
        {options.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {canManage && (
        <>
          <div className="label">Кількість годин</div>
          <div className="row2" style={{ marginTop: 0 }}>
            <input type="number" inputMode="decimal" min={0} value={hours} onChange={(e) => setHours(e.target.value)} />
            <select value={unit} onChange={(e) => setUnit(e.target.value as "week" | "month")}>
              <option value="week">на тиждень</option>
              <option value="month">на місяць</option>
            </select>
          </div>
        </>
      )}
      {error && <div className="error">{error}</div>}
      <div className="row2">
        <button className="secondary" onClick={onCancel}>Скасувати</button>
        <button className="secondary" style={{ borderColor: "var(--btn)" }} disabled={saving} onClick={submit}>{saving ? "Зберігаю…" : "Зберегти"}</button>
      </div>
    </div>
  );
}
