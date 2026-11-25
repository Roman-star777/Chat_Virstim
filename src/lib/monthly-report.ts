import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEmployees } from "./employees-db";
import { buildEmployeesPdf } from "./employees-pdf";
import { monthLabel } from "./employees";
import { tgSendDocument } from "./bot";

/** Робить PDF за місяць і надсилає в чат. */
export async function sendMonthlyPdf(db: SupabaseClient, month: string, chatId: number) {
  const r = await loadEmployees(db, month);
  if ("error" in r) throw r.error;
  const pdf = await buildEmployeesPdf({ month, employees: r.employees, lastChange: r.lastChange, generatedBy: "бот (автоматично)" });
  const total = r.employees.reduce((s, e) => s + (e.hours ?? 0), 0);
  const caption = `Список працівників за ${monthLabel(month).toLowerCase()}: ${r.employees.length} осіб, ${String(Math.round(total * 100) / 100).replace(".", ",")} год.`;
  return tgSendDocument(chatId, `pracivnyky-${month}.pdf`, pdf, caption);
}

/**
 * Надсилає список за місяць у групу рівно один раз: спершу «займає» місяць у monthly_reports,
 * якщо надіслати не вдалось — звільняє, щоб наступний запуск спробував ще.
 */
export async function sendMonthlyReportOnce(db: SupabaseClient, month: string, chatId: number) {
  const { data: claim, error } = await db.from("monthly_reports")
    .upsert({ month: `${month}-01`, chat_id: chatId }, { onConflict: "month", ignoreDuplicates: true })
    .select("month");
  if (error) throw error;
  if (!claim?.length) return { status: "already_sent" as const };
  try {
    const msg = await sendMonthlyPdf(db, month, chatId);
    await db.from("monthly_reports").update({ tg_message_id: msg.message_id }).eq("month", `${month}-01`);
    return { status: "sent" as const, messageId: msg.message_id };
  } catch (e) {
    await db.from("monthly_reports").delete().eq("month", `${month}-01`).is("tg_message_id", null);
    throw e;
  }
}
