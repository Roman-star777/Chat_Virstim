import { describe, expect, it, vi, beforeEach } from "vitest";
import { monthlyReportDue } from "@/lib/monthly";

describe("коли надсилати список за місяць", () => {
  it("10-го о 9:00 і пізніше — за попередній місяць", () => {
    expect(monthlyReportDue("2026-12-10", 9, 9)).toBe("2026-11");
    expect(monthlyReportDue("2026-12-10", 17, 9)).toBe("2026-11");
  });
  it("10-го до 9:00 — ще ні", () => {
    expect(monthlyReportDue("2026-12-10", 8, 9)).toBeNull();
  });
  it("до 10-го і після 15-го — ні; 11–15 — дозвідправка", () => {
    expect(monthlyReportDue("2026-12-09", 12, 9)).toBeNull();
    expect(monthlyReportDue("2026-11-25", 12, 9)).toBeNull();
    expect(monthlyReportDue("2026-12-12", 0, 9)).toBe("2026-11");
    expect(monthlyReportDue("2026-12-15", 23, 9)).toBe("2026-11");
    expect(monthlyReportDue("2026-12-16", 9, 9)).toBeNull();
  });
  it("у січні — за грудень минулого року", () => {
    expect(monthlyReportDue("2027-01-10", 9, 9)).toBe("2026-12");
  });
});

// --- захист від повторів ----------------------------------------------------
const sent: number[] = [];
let failSend = false;
vi.mock("@/lib/bot", () => ({
  tgSendDocument: vi.fn(async () => {
    if (failSend) throw new Error("telegram down");
    sent.push(1);
    return { message_id: 100 + sent.length };
  }),
}));
vi.mock("@/lib/employees-db", () => ({
  loadEmployees: vi.fn(async () => ({ employees: [{ id: "1", full_name: "A", contract_type: "DPČ", hours: 10, active: true, updated_at: "2026-11-01T00:00:00Z", updated_by_name: null }], lastChange: null, monthsWithHours: [] })),
}));
vi.mock("@/lib/employees-pdf", () => ({ buildEmployeesPdf: vi.fn(async () => new Uint8Array([1])) }));

/** Мінімальна імітація таблиці monthly_reports з первинним ключем month. */
function fakeDb() {
  const rows = new Map<string, { month: string; chat_id: number; tg_message_id: number | null }>();
  const db = {
    rows,
    from: () => ({
      upsert: (r: { month: string; chat_id: number }) => ({
        select: async () => {
          if (rows.has(r.month)) return { data: [], error: null };
          rows.set(r.month, { ...r, tg_message_id: null });
          return { data: [{ month: r.month }], error: null };
        },
      }),
      update: (v: { tg_message_id: number }) => ({
        eq: async (_: string, m: string) => { const x = rows.get(m); if (x) x.tg_message_id = v.tg_message_id; return { error: null }; },
      }),
      delete: () => ({
        eq: (_: string, m: string) => ({ is: async () => { if (rows.get(m)?.tg_message_id === null) rows.delete(m); return { error: null }; } }),
      }),
    }),
  };
  return db;
}

describe("список надсилається лише раз на місяць", () => {
  beforeEach(() => { sent.length = 0; failSend = false; });

  it("другий запуск того ж місяця нічого не шле", async () => {
    const { sendMonthlyReportOnce } = await import("@/lib/monthly-report");
    const db = fakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await sendMonthlyReportOnce(db as any, "2026-11", -1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = await sendMonthlyReportOnce(db as any, "2026-11", -1);
    expect(a.status).toBe("sent");
    expect(b.status).toBe("already_sent");
    expect(sent.length).toBe(1);
    expect(db.rows.get("2026-11-01")?.tg_message_id).toBe(101);
  });

  it("якщо Telegram не прийняв — наступний запуск пробує ще раз", async () => {
    const { sendMonthlyReportOnce } = await import("@/lib/monthly-report");
    const db = fakeDb();
    failSend = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(sendMonthlyReportOnce(db as any, "2026-11", -1)).rejects.toThrow("telegram down");
    expect(db.rows.size).toBe(0);
    failSend = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await sendMonthlyReportOnce(db as any, "2026-11", -1)).status).toBe("sent");
    expect(sent.length).toBe(1);
  });
});
