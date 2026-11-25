export const CONTRACT_TYPES = ["HPP", "DPP", "DPČ", "IČO", "Інше"] as const;

export type Employee = {
  id: string;
  full_name: string;
  contract_type: string;
  hours: number | null;
  hours_unit: "week" | "month";
  active: boolean;
  updated_at: string;
  updated_by_name: string | null;
};

export type EmployeeInput = {
  full_name?: string;
  contract_type?: string;
  hours?: number | null;
  hours_unit?: "week" | "month";
  active?: boolean;
};

/** Перевіряє поля працівника. partial=true — для редагування (поля необовʼязкові). */
export function validateEmployee(input: unknown, partial: boolean): { ok: true; value: EmployeeInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Порожній запит" };
  const i = input as Record<string, unknown>;
  const out: EmployeeInput = {};
  if (i.full_name !== undefined || !partial) {
    const v = typeof i.full_name === "string" ? i.full_name.trim() : "";
    if (!v) return { ok: false, error: "Вкажіть імʼя і прізвище" };
    if (v.length > 200) return { ok: false, error: "Імʼя задовге" };
    out.full_name = v;
  }
  if (i.contract_type !== undefined || !partial) {
    const v = typeof i.contract_type === "string" ? i.contract_type.trim() : "";
    if (!v) return { ok: false, error: "Вкажіть тип договору" };
    if (v.length > 50) return { ok: false, error: "Тип договору задовгий" };
    out.contract_type = v;
  }
  if (i.hours !== undefined) {
    if (i.hours === null || i.hours === "") out.hours = null;
    else {
      const n = typeof i.hours === "number" ? i.hours : Number(String(i.hours).replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n > 9999) return { ok: false, error: "Неправильна кількість годин" };
      out.hours = Math.round(n * 100) / 100;
    }
  }
  if (i.hours_unit !== undefined) {
    if (i.hours_unit !== "week" && i.hours_unit !== "month") return { ok: false, error: "Години: на тиждень або на місяць" };
    out.hours_unit = i.hours_unit;
  }
  if (i.active !== undefined) {
    if (typeof i.active !== "boolean") return { ok: false, error: "Неправильне значення" };
    out.active = i.active;
  }
  if (partial && Object.keys(out).length === 0) return { ok: false, error: "Немає змін" };
  return { ok: true, value: out };
}

export function hoursLabel(e: Pick<Employee, "hours" | "hours_unit">): string {
  if (e.hours === null || e.hours === undefined) return "—";
  const n = Number(e.hours).toString().replace(".", ",");
  return `${n} год/${e.hours_unit === "week" ? "тиж." : "міс."}`;
}

export function formatDateTime(iso: string, tz = "Europe/Prague"): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}
