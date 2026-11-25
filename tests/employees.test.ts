import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hoursLabel, validateEmployee, type Employee } from "@/lib/employees";
import { buildEmployeesPdf } from "@/lib/employees-pdf";

describe("перевірка полів працівника", () => {
  it("нове: потрібні імʼя і тип договору", () => {
    expect(validateEmployee({ full_name: "Іван Петренко", contract_type: "HPP", hours: "40", hours_unit: "week" }, false))
      .toEqual({ ok: true, value: { full_name: "Іван Петренко", contract_type: "HPP", hours: 40, hours_unit: "week" } });
    expect(validateEmployee({ contract_type: "HPP" }, false)).toMatchObject({ ok: false });
  });
  it("години з комою, порожні години, відʼємні", () => {
    expect(validateEmployee({ hours: "7,5" }, true)).toEqual({ ok: true, value: { hours: 7.5 } });
    expect(validateEmployee({ hours: "" }, true)).toEqual({ ok: true, value: { hours: null } });
    expect(validateEmployee({ hours: -1 }, true)).toMatchObject({ ok: false });
  });
  it("редагування без полів — помилка", () => {
    expect(validateEmployee({}, true)).toMatchObject({ ok: false });
  });
  it("підпис годин", () => {
    expect(hoursLabel({ hours: 40, hours_unit: "week" })).toBe("40 год/тиж.");
    expect(hoursLabel({ hours: 7.5, hours_unit: "month" })).toBe("7,5 год/міс.");
    expect(hoursLabel({ hours: null, hours_unit: "week" })).toBe("—");
  });
});

describe("PDF зі списком працівників", () => {
  const emp = (i: number, active = true): Employee => ({
    id: String(i), full_name: `Працівник Номер ${i} Ґалаґан-Їжаченко`, contract_type: i % 2 ? "HPP" : "DPP",
    hours: 40, hours_unit: "week", active, updated_at: "2026-11-25T13:40:00Z", updated_by_name: "Саша",
  });

  it("містить кирилицю, лише активних, рядок про останню зміну, кілька сторінок", async () => {
    const employees = [...Array.from({ length: 45 }, (_, i) => emp(i + 1)), emp(99, false)];
    const pdf = await buildEmployeesPdf({
      employees, lastChange: { by: "Саша", at: "2026-11-25T13:40:00Z" }, generatedBy: "Роман",
      now: new Date("2026-11-25T14:00:00Z"),
    });
    const dir = mkdtempSync(path.join(tmpdir(), "pdf-"));
    const file = path.join(dir, "e.pdf");
    writeFileSync(file, pdf);
    const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString();
    expect(text).toContain("Список працівників");
    expect(text).toContain("усього: 45");
    expect(text).toContain("Остання зміна: Саша, 25.11.2026");
    expect(text).toContain("14:40"); // 13:40 UTC = 14:40 у Празі
    expect(text).toContain("Ґалаґан-Їжаченко");
    expect(text).not.toContain("Номер 99");
    expect(text).toContain("стор. 2 з 2");
  });
});
