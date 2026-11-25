import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { mintDownloadToken } from "@/lib/session";

/** Видає посилання на PDF, що діє 5 хвилин (Telegram відкриває його поза міні-апкою). */
export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const token = await mintDownloadToken(auth.session.memberId, "employees_pdf");
  const url = new URL(`/api/employees/pdf?t=${encodeURIComponent(token)}`, req.url);
  return NextResponse.json({ url: url.toString() });
}
