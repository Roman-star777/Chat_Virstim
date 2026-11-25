import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { formatDateTime, hoursLabel, type Employee } from "./employees";

async function loadFonts(): Promise<{ regular: Uint8Array; bold: Uint8Array }> {
  const dir = path.join(process.cwd(), "assets", "fonts");
  const [regular, bold] = await Promise.all([
    readFile(path.join(dir, "DejaVuSans.ttf")),
    readFile(path.join(dir, "DejaVuSans-Bold.ttf")),
  ]);
  return { regular, bold };
}

/** PDF зі списком активних працівників і рядком «остання зміна». */
export async function buildEmployeesPdf(opts: {
  employees: Employee[];
  lastChange: { by: string | null; at: string } | null;
  generatedBy: string;
  now?: Date;
}): Promise<Uint8Array> {
  const now = opts.now ?? new Date();
  const fonts = await loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  doc.setTitle("Список працівників");

  const A4: [number, number] = [595.28, 841.89];
  const margin = 48;
  const cols = [
    { title: "№", x: margin, w: 28 },
    { title: "Імʼя і прізвище", x: margin + 28, w: 250 },
    { title: "Тип договору", x: margin + 278, w: 110 },
    { title: "Години", x: margin + 388, w: 111 },
  ];
  const rowH = 22;
  const grey = rgb(0.4, 0.4, 0.4);

  let page = doc.addPage(A4);
  let y = A4[1] - margin;

  const text = (s: string, x: number, yy: number, font: PDFFont, size: number, color = rgb(0, 0, 0)) =>
    page.drawText(s, { x, y: yy, size, font, color });

  const fit = (s: string, font: PDFFont, size: number, w: number) => {
    let t = s;
    while (t.length > 1 && font.widthOfTextAtSize(t, size) > w - 6) t = t.slice(0, -1);
    return t === s ? s : `${t.slice(0, -1)}…`;
  };

  const header = () => {
    for (const c of cols) text(c.title, c.x, y, bold, 10);
    y -= 8;
    page.drawLine({ start: { x: margin, y }, end: { x: A4[0] - margin, y }, thickness: 0.8, color: grey });
    y -= rowH - 6;
  };

  text("Список працівників", margin, y, bold, 18);
  y -= 22;
  const active = opts.employees.filter((e) => e.active);
  text(`Станом на ${formatDateTime(now.toISOString())} · усього: ${active.length}`, margin, y, regular, 10, grey);
  y -= 14;
  const lc = opts.lastChange
    ? `Остання зміна: ${opts.lastChange.by ?? "система"}, ${formatDateTime(opts.lastChange.at)}`
    : "Змін ще не було";
  text(lc, margin, y, regular, 10, grey);
  y -= 28;
  header();

  active.forEach((e, idx) => {
    if (y < margin + rowH) {
      page = doc.addPage(A4);
      y = A4[1] - margin;
      header();
    }
    const cells = [String(idx + 1), e.full_name, e.contract_type, hoursLabel(e)];
    cells.forEach((v, i) => text(fit(v, regular, 10, cols.at(i)!.w), cols.at(i)!.x, y, regular, 10));
    y -= rowH;
  });

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`Сформував: ${opts.generatedBy} · стор. ${i + 1} з ${pages.length}`, {
      x: margin, y: margin / 2, size: 8, font: regular, color: grey,
    });
  });
  return doc.save();
}
