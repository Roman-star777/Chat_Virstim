import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { dbService } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Роман або Сергій підтверджує запит на доступ: привʼязує Telegram-акаунт до вільного імені
 * (Сергій або Саша). Зайняте імʼя перепривʼязати не можна, щоб ніхто не «вкрав» чужий доступ.
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;

  const { data: me } = await auth.db.from("members").select("can_manage_employees").eq("id", auth.session.memberId).single();
  if (!me?.can_manage_employees) return jsonError(403, "Підтверджувати доступ можуть лише Роман і Сергій");

  let body: { action?: string; memberId?: string };
  try { body = await req.json(); } catch { return jsonError(400, "Неправильний запит"); }

  const svc = dbService();
  const { data: request } = await svc.from("access_requests").select("*").eq("id", id).is("resolved_at", null).maybeSingle();
  if (!request) return jsonError(404, "Запит не знайдено або вже вирішено");

  if (body.action === "reject") {
    await svc.from("access_requests").update({ resolved_at: new Date().toISOString(), resolved_by: auth.session.memberId, resolution: "rejected" }).eq("id", id);
    return NextResponse.json({ ok: true });
  }
  if (body.action !== "approve" || !body.memberId) return jsonError(400, "Оберіть імʼя");

  const { data: linked, error } = await svc
    .from("members")
    .update({ tg_user_id: request.tg_user_id, tg_username: request.tg_username })
    .eq("id", body.memberId)
    .is("tg_user_id", null)
    .eq("active", true)
    .select("id");
  if (error || !linked?.length) return jsonError(409, "Це імʼя вже привʼязане до іншого акаунта");

  await svc.from("access_requests").update({ resolved_at: new Date().toISOString(), resolved_by: auth.session.memberId, resolution: "approved" }).eq("id", id);
  return NextResponse.json({ ok: true });
}
