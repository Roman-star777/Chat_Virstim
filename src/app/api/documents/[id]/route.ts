import { NextResponse } from "next/server";
import { requireSession, dbError, jsonError } from "@/lib/api";
import { CATEGORIES, type Category } from "@/lib/doc-rules";

type Ctx = { params: Promise<{ id: string }> };

/** Підтвердити або змінити категорію документа. */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (!CATEGORIES.includes(body.category as Category)) return jsonError(400, "Неправильна категорія");
  const { data, error } = await auth.db.from("documents").update({
    category: body.category, status: "confirmed", confirmed_by: auth.session.memberId,
    confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", id).select("id");
  if (error) return dbError(error);
  if (!data?.length) return jsonError(404, "Документ не знайдено");
  return NextResponse.json({ ok: true });
}
