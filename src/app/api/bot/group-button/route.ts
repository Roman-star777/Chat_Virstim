import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dbService } from "@/lib/supabase";
import { hasMainApp, postGroupButton } from "@/lib/group-button";
import { appUrl, tgCall, TgError } from "@/lib/bot";
import { sendMonthlyPdf } from "@/lib/monthly-report";
import { NOTICE } from "@/lib/bot-handlers";
import { isMonth } from "@/lib/employees";

export const runtime = "nodejs";

/** Службовий запуск (той самий ключ, що й для нагадувань): опублікувати й закріпити кнопку в групі. */
export async function POST(req: Request) {
  const db = dbService();
  const got = req.headers.get("x-cron-token") ?? "";
  const { data: sec } = await db.from("internal_secrets").select("value").eq("name", "cron").single();
  const a = Buffer.from(got), b = Buffer.from(String(sec?.value ?? ""));
  if (!sec || a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: s } = await db.from("settings").select("group_chat_id").single();
  if (!s?.group_chat_id) return NextResponse.json({ error: "бот ще не в групі" }, { status: 409 });
  const sp = new URL(req.url).searchParams;
  if (sp.get("test_monthly")) {
    // Перевірка PDF-розсилки: надіслати список за місяць особисто Роману (не в групу)
    const month = sp.get("test_monthly")!;
    if (!isMonth(month)) return NextResponse.json({ error: "month" }, { status: 400 });
    const { data: r } = await db.from("members").select("tg_user_id").eq("name", "Роман").single();
    if (!r?.tg_user_id) return NextResponse.json({ error: "Роман не привʼязаний" }, { status: 409 });
    try {
      const msg = await sendMonthlyPdf(db, month, Number(r.tg_user_id));
      return NextResponse.json({ sent: true, messageId: msg.message_id });
    } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
  }
  if (sp.get("edit_notice")) {
    // Оновити текст вітання бота в групі (без згадок про ШІ)
    try {
      await tgCall("editMessageText", { chat_id: s.group_chat_id, message_id: Number(sp.get("edit_notice")), text: NOTICE });
      return NextResponse.json({ edited: true });
    } catch (e) { return NextResponse.json({ error: e instanceof TgError ? e.description : String(e) }, { status: 500 }); }
  }
  if (sp.get("probe") === "1") {
    // Перевірка: чи дозволяє Telegram кнопку меню (синя кнопка біля поля вводу) у групі
    const me = await tgCall<Record<string, unknown>>("getMe");
    let menu: string;
    try {
      await tgCall("setChatMenuButton", { chat_id: s.group_chat_id, menu_button: { type: "web_app", text: "Задачі", web_app: { url: appUrl() } } });
      menu = "ok";
    } catch (e) { menu = e instanceof TgError ? `${e.code} ${e.description}` : String(e); }
    return NextResponse.json({ has_main_web_app: me.has_main_web_app ?? null, menuButtonInGroup: menu });
  }
  if (!(await hasMainApp())) {
    return NextResponse.json({ error: "у BotFather не увімкнено головну міні-апку (Configure Mini App)" }, { status: 409 });
  }
  try {
    return NextResponse.json(await postGroupButton(s.group_chat_id, true));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
