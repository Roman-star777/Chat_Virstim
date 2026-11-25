import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hoursLabel, isMonth, monthLabel, parseHours, shiftMonth, validateEmployee, type Employee } from "@/lib/employees";
import { buildEmployeesPdf } from "@/lib/employees-pdf";

describe("перевірка полів працівника", () => {
  it("нове: потрібні імʼя і тип договору з трьох", () => {
    expect(validateEmployee({ full_name: "  Іван   Петренко ", contract_type: "HPP" }, false))
      .toEqual({ ok: true, value: { full_name: "Іван Петренко", contract_type: "HPP" } });
    expect(validateEmployee({ contract_type: "HPP" }, false)).toMatchObject({ ok: false });
    expect(validateEmployee({ full_name: "Іван", contract_type: "IČO" }, false)).toMatchObject({ ok: false });
    expect(validateEmployee({ contract_type: "DPČ" }, true)).toEqual({ ok: true, value: { contract_type: "DPČ" } });
  });
  it("редагування без полів — помилка", () => {
    expect(validateEmployee({}, true)).toMatchObject({ ok: false });
  });
  it("години з комою, порожні, відʼємні", () => {
    expect(parseHours("7,5")).toEqual({ ok: true, value: 7.5 });
    expect(parseHours(" 149.5 ")).toEqual({ ok: true, value: 149.5 });
    expect(parseHours("")).toEqual({ ok: true, value: null });
    expect(parseHours(null)).toEqual({ ok: true, value: null });
    expect(parseHours(-1)).toMatchObject({ ok: false });
    expect(parseHours("abc")).toMatchObject({ ok: false });
  });
  it("підпис годин", () => {
    expect(hoursLabel(149.5)).toBe("149,5");
    expect(hoursLabel(40)).toBe("40");
    expect(hoursLabel(null)).toBe("—");
  });
  it("місяці", () => {
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-1")).toBe(false);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthLabel("2026-10")).toBe("Жовтень 2026");
  });
});

describe("PDF зі списком працівників", () => {
  const emp = (i: number, active = true): Employee => ({
    id: String(i), full_name: `Працівник Номер ${i} Ґалаґан-Їжаченко`, contract_type: i % 2 ? "HPP" : "DPP",
    hours: i === 3 ? null : 40, active, updated_at: "2026-11-25T13:40:00Z", updated_by_name: "Саша",
  });

  it("містить кирилицю, лише активних, рядок про останню зміну, кілька сторінок", async () => {
    const employees = [...Array.from({ length: 45 }, (_, i) => emp(i + 1)), emp(99, false)];
    const pdf = await buildEmployeesPdf({
      month: "2026-10", employees, lastChange: { by: "Саша", at: "2026-11-25T13:40:00Z" }, generatedBy: "Роман",
      now: new Date("2026-11-25T14:00:00Z"),
    });
    const dir = mkdtempSync(path.join(tmpdir(), "pdf-"));
    const file = path.join(dir, "e.pdf");
    writeFileSync(file, pdf);
    const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString();
    expect(text).toContain("Список працівників · Жовтень 2026");
    expect(text).toContain("усього: 45");
    expect(text).toContain("Остання зміна: Саша, 25.11.2026");
    expect(text).toContain("14:40"); // 13:40 UTC = 14:40 у Празі
    expect(text).toContain("Ґалаґан-Їжаченко");
    expect(text).not.toContain("Номер 99");
    expect(text).toContain("стор. 2 з 2");
  });
});
