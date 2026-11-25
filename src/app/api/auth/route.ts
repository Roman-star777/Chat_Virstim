import { NextResponse } from "next/server";
import { verifyInitData, InitDataError } from "@/lib/telegram";
import { mintSession } from "@/lib/session";
import { dbService } from "@/lib/supabase";
import { jsonError } from "@/lib/api";

/**
 * Вхід у міні-апку. Сервер перевіряє підпис Telegram і шукає людину в списку з 3 імен.
 * - знайдено → видає пропуск на 1 годину;
 * - це BOOTSTRAP_TG_USER_ID (Роман) і Роман ще не привʼязаний → привʼязує і пускає;
 * - інакше → записує запит на доступ, який підтверджує Роман або Сергій.
 */
export async function POST(req: Request) {
  let initData = "";
  try {
    initData = String((await req.json())?.initData ?? "");
  } catch {
    return jsonError(400, "Неправильний запит");
  }

  let user;
  try {
    ({ user } = verifyInitData(initData, process.env.TELEGRAM_BOT_TOKEN ?? ""));
  } catch (e) {
    const reason = e instanceof InitDataError ? e.message : "помилка перевірки";
    return jsonError(401, `Не вдалося перевірити вхід Telegram (${reason})`);
  }

  const db = dbService();
  const { data: member, error } = await db
    .from("members")
    .select("id, name, active")
    .eq("tg_user_id", user.id)
    .maybeSingle();
  if (error) return jsonError(500, "Помилка бази даних");

  let found = member;
  if (!found && String(user.id) === process.env.BOOTSTRAP_TG_USER_ID) {
    const { data: roman } = await db
      .from("members")
      .update({ tg_user_id: user.id, tg_username: user.username ?? null })
      .eq("name", "Роман")
      .is("tg_user_id", null)
      .select("id, name, active")
      .maybeSingle();
    found = roman;
  }

  if (found && found.active) {
    if (user.username) await db.from("members").update({ tg_username: user.username }).eq("id", found.id);
    const token = await mintSession({ memberId: found.id, tgUserId: user.id });
    return NextResponse.json({ token, memberId: found.id, name: found.name });
  }

  if (!found) {
    await db.from("access_requests").upsert(
      {
        tg_user_id: user.id,
        tg_first_name: user.first_name ?? null,
        tg_last_name: user.last_name ?? null,
        tg_username: user.username ?? null,
      },
      { onConflict: "tg_user_id", ignoreDuplicates: true },
    );
  }
  return NextResponse.json(
    { error: "Доступ заборонено. Запит надіслано: його має підтвердити Роман або Сергій.", pending: !found },
    { status: 403 },
  );
}
