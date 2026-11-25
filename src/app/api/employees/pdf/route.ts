import { verifyDownloadToken, mintSession } from "@/lib/session";
import { dbAsMember } from "@/lib/supabase";
import { buildEmployeesPdf } from "@/lib/employees-pdf";
import { jsonError } from "@/lib/api";
import { loadEmployees } from "@/lib/employees-db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  let memberId: string;
  try {
    memberId = await verifyDownloadToken(t, "employees_pdf");
  } catch {
    return jsonError(401, "Посилання застаріло. Натисніть «Скачати PDF» у міні-апці ще раз.");
  }
  // Читаємо від імені цієї людини, щоб RLS перевірила доступ ще раз
  const token = await mintSession({ memberId, tgUserId: 0 });
  const db = dbAsMember(token);
  const r = await loadEmployees(db);
  if ("error" in r) return jsonError(403, "Немає доступу");
  const { data: me } = await db.from("members").select("name").eq("id", memberId).single();
  if (!me) return jsonError(403, "Немає доступу");

  const pdf = await buildEmployeesPdf({ employees: r.employees, lastChange: r.lastChange, generatedBy: me.name });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="pracivnyky-${date}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
