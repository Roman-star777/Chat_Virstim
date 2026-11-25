import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dbService } from "@/lib/supabase";
import { hasMainApp, postGroupButton } from "@/lib/group-button";
import { appUrl, tgCall, TgError } from "@/lib/bot";

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
  if (new URL(req.url).searchParams.get("probe") === "1") {
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
