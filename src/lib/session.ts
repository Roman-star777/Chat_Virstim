import { SignJWT, jwtVerify } from "jose";

/**
 * Пропуск для бази: JWT, підписаний секретом Supabase. RLS у базі читає з нього member_id.
 * Живе 1 годину; міні-апка отримує новий при кожному відкритті.
 */
const SESSION_TTL = "1h";

function secret(): Uint8Array {
  const s = process.env.SUPABASE_JWT_SECRET;
  if (!s) throw new Error("Не задано SUPABASE_JWT_SECRET");
  return new TextEncoder().encode(s);
}

export type Session = { memberId: string; tgUserId: number };

export async function mintSession(s: Session): Promise<string> {
  return new SignJWT({ role: "authenticated", member_id: s.memberId, tg_user_id: s.tgUserId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(s.memberId)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secret());
}

export async function verifySession(token: string): Promise<Session> {
  const { payload } = await jwtVerify(token, secret(), { audience: "authenticated", algorithms: ["HS256"] });
  if (typeof payload.member_id !== "string" || typeof payload.tg_user_id !== "number") {
    throw new Error("Неправильний пропуск");
  }
  return { memberId: payload.member_id, tgUserId: payload.tg_user_id };
}

/** Короткий одноразовий токен для скачування PDF (5 хвилин), щоб посилання не жило довго. */
export async function mintDownloadToken(memberId: string, purpose: string): Promise<string> {
  return new SignJWT({ purpose, member_id: memberId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("download")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret());
}

export async function verifyDownloadToken(token: string, purpose: string): Promise<string> {
  const { payload } = await jwtVerify(token, secret(), { audience: "download", algorithms: ["HS256"] });
  if (payload.purpose !== purpose || typeof payload.member_id !== "string") throw new Error("Неправильний токен");
  return payload.member_id;
}
