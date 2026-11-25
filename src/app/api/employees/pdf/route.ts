import { verifyDownloadToken, mintSession } from "@/lib/session";
import { dbAsMember } from "@/lib/supabase";
import { buildEmployeesPdf } from "@/lib/employees-pdf";
import { jsonError } from "@/lib/api";
import { loadEmployees } from "@/lib/employees-db";
import { isMonth } from "@/lib/employees";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const t = sp.get("t") ?? "";
  const month = sp.get("m");
  if (!isMonth(month)) return jsonError(400, "Неправильний місяць");
  let memberId: string;
  try {
    memberId = await verifyDownloadToken(t, "employees_pdf");
  } catch {
    return jsonError(401, "Посилання застаріло. Натисніть «Скачати PDF» у міні-апці ще раз.");
  }
  // Читаємо від імені цієї людини, щоб RLS перевірила доступ ще раз
  const token = await mintSession({ memberId, tgUserId: 0 });
  const db = dbAsMember(token);
  const r = await loadEmployees(db, month);
  if ("error" in r) return jsonError(403, "Немає доступу");
  const { data: me } = await db.from("members").select("name").eq("id", memberId).single();
  if (!me) return jsonError(403, "Немає доступу");

  const pdf = await buildEmployeesPdf({ month, employees: r.employees, lastChange: r.lastChange, generatedBy: me.name });
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="pracivnyky-${month}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
