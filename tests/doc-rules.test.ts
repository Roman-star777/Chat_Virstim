import { describe, expect, it } from "vitest";
import { suggestCategory } from "@/lib/doc-rules";

describe("підказка категорії за назвою файлу (без ШІ)", () => {
  it("рахунки", () => {
    expect(suggestCategory("Faktura_2026-11.pdf")).toBe("invoices");
    expect(suggestCategory("Рахунок листопад.pdf")).toBe("invoices");
    expect(suggestCategory("Účtenka.jpg")).toBe("invoices");
  });
  it("договори, у тому числі DPP/DPČ як окреме слово", () => {
    expect(suggestCategory("Smlouva o dílo.pdf")).toBe("contracts");
    expect(suggestCategory("DPČ Paseka.pdf")).toBe("contracts");
    expect(suggestCategory("Договір оренди.docx")).toBe("contracts");
    expect(suggestCategory("happy.jpg")).toBe("other"); // «hpp» усередині слова — не договір
  });
  it("банк і податки", () => {
    expect(suggestCategory("Výpis z účtu 10-2026.pdf")).toBe("bank");
    expect(suggestCategory("DPH přiznání Q3.pdf")).toBe("taxes");
    expect(suggestCategory("VZP oznámení.pdf")).toBe("taxes");
  });
  it("підпис у чаті теж враховується; інакше — «Інше»", () => {
    expect(suggestCategory("IMG_4128.jpg", "рахунок від Alza")).toBe("invoices");
    expect(suggestCategory("photo-2026-11-25-7.jpg")).toBe("other");
  });
});
