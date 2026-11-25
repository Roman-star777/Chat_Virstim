import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifySession, type Session } from "./session";
import { dbAsMember } from "./supabase";

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** Перевіряє пропуск із заголовка Authorization і дає клієнт бази від імені цієї людини. */
export async function requireSession(req: Request): Promise<{ session: Session; db: SupabaseClient } | NextResponse> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return jsonError(401, "Потрібен вхід через Telegram");
  try {
    const session = await verifySession(token);
    return { session, db: dbAsMember(token) };
  } catch {
    return jsonError(401, "Пропуск недійсний або застарів, відкрийте міні-апку знову");
  }
}

/** Перекладає помилки бази в зрозумілі повідомлення. */
export function dbError(e: { code?: string; message?: string } | null) {
  if (!e) return jsonError(500, "Невідома помилка");
  if (e.code === "42501") {
    const msg = e.message && !e.message.startsWith("new row violates") && !e.message.startsWith("permission denied")
      ? e.message
      : "Немає прав на цю дію";
    return jsonError(403, msg);
  }
  console.error("DB error", e);
  return jsonError(500, "Помилка бази даних");
}
