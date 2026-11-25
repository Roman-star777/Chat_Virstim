import { NextResponse } from "next/server";
import { requireSession, dbError } from "@/lib/api";

/** Усі документи з групи. */
export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const [docs, members, settings] = await Promise.all([
    auth.db.from("documents").select("id, file_name, mime_type, size_bytes, status, category, storage_path, uploaded_by, created_at, confirmed_by, source_message_id")
      .order("created_at", { ascending: false }).limit(500),
    auth.db.from("members").select("id, name"),
    auth.db.from("settings").select("group_chat_id").single(),
  ]);
  for (const r of [docs, members, settings]) if (r.error) return dbError(r.error);
  const names = new Map((members.data ?? []).map((m) => [m.id, m.name as string]));
  return NextResponse.json({
    documents: (docs.data ?? []).map(({ uploaded_by, confirmed_by, storage_path, ...d }) => ({
      ...d,
      stored: !!storage_path,
      uploaded_by_name: uploaded_by ? names.get(uploaded_by) ?? null : null,
      confirmed: !!confirmed_by,
    })),
    groupConnected: !!settings.data!.group_chat_id,
  });
}
