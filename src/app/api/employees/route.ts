import { NextResponse } from "next/server";
import { requireSession, dbError, jsonError } from "@/lib/api";
import { validateEmployee } from "@/lib/employees";
import { loadEmployees } from "@/lib/employees-db";

export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  const r = await loadEmployees(auth.db);
  if ("error" in r) return dbError(r.error ?? null);
  const { data: me } = await auth.db.from("members").select("can_manage_employees").eq("id", auth.session.memberId).single();
  return NextResponse.json({ ...r, canManage: me?.can_manage_employees === true });
}

export async function POST(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof NextResponse) return auth;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, "Неправильний запит"); }
  const v = validateEmployee(body, false);
  if (!v.ok) return jsonError(400, v.error);
  const { data, error } = await auth.db.from("employees").insert(v.value).select("id").single();
  if (error) return dbError(error);
  return NextResponse.json({ id: data.id }, { status: 201 });
}
