import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { mintDownloadToken } from "@/lib/session";
import { isMonth } from "@/lib/employees";

/** Видає посилання на PDF за місяць, що діє 5 хвилин (Telegram відкриває його поза міні-апкою). */
export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  if (!isMonth(body.month)) return jsonError(400, "Неправильний місяць");
  const token = await mintDownloadToken(auth.session.memberId, "employees_pdf");
  const url = new URL(`/api/employees/pdf?m=${body.month}&t=${encodeURIComponent(token)}`, req.url);
  return NextResponse.json({ url: url.toString() });
}
