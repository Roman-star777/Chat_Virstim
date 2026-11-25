import { NextResponse } from "next/server";
import { requireSession, dbError, jsonError } from "@/lib/api";
import { dbService } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

/** Тимчасове посилання (2 хв) на файл у закритому сховищі. Доступ перевіряє RLS: документ має бути видно цій людині. */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  const { data: doc, error } = await auth.db.from("documents").select("storage_path, file_name").eq("id", id).maybeSingle();
  if (error) return dbError(error);
  if (!doc?.storage_path) return jsonError(404, "Файл недоступний");
  const s = await dbService().storage.from("documents").createSignedUrl(doc.storage_path, 120, { download: doc.file_name });
  if (s.error) return jsonError(500, "Не вдалося створити посилання");
  return NextResponse.json({ url: s.data.signedUrl, fileName: doc.file_name });
}
