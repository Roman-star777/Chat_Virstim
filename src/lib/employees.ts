export const CONTRACT_TYPES = ["DPP", "DPČ", "HPP"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

/** Працівник із годинами за вибраний місяць. */
export type Employee = {
  id: string;
  full_name: string;
  contract_type: string;
  hours: number | null;
  active: boolean;
  updated_at: string;
  updated_by_name: string | null;
};

export type EmployeeInput = {
  full_name?: string;
  contract_type?: ContractType;
  active?: boolean;
};

/** Перевіряє поля працівника. partial=true — для редагування (поля необовʼязкові). */
export function validateEmployee(input: unknown, partial: boolean): { ok: true; value: EmployeeInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Порожній запит" };
  const i = input as Record<string, unknown>;
  const out: EmployeeInput = {};
  if (i.full_name !== undefined || !partial) {
    const v = typeof i.full_name === "string" ? i.full_name.trim().replace(/\s+/g, " ") : "";
    if (!v) return { ok: false, error: "Вкажіть імʼя і прізвище" };
    if (v.length > 200) return { ok: false, error: "Імʼя задовге" };
    out.full_name = v;
  }
  if (i.contract_type !== undefined || !partial) {
    if (!CONTRACT_TYPES.includes(i.contract_type as ContractType)) return { ok: false, error: "Тип договору: DPP, DPČ або HPP" };
    out.contract_type = i.contract_type as ContractType;
  }
  if (i.active !== undefined) {
    if (typeof i.active !== "boolean") return { ok: false, error: "Неправильне значення" };
    out.active = i.active;
  }
  if (partial && Object.keys(out).length === 0) return { ok: false, error: "Немає змін" };
  return { ok: true, value: out };
}

/** Години: число з комою або крапкою, порожньо = null. */
export function parseHours(v: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return { ok: true, value: null };
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 9999) return { ok: false, error: "Неправильна кількість годин" };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** Місяць у форматі "2026-10". */
export function isMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}
export function monthToDate(m: string): string {
  return `${m}-01`;
}
export function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const MONTHS = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
export function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTHS[mo - 1]} ${y}`;
}

export function hoursLabel(h: number | null | undefined): string {
  if (h === null || h === undefined) return "—";
  return Number(h).toString().replace(".", ",");
}

export function formatDateTime(iso: string, tz = "Europe/Prague"): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}
