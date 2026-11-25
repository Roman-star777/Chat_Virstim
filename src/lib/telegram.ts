import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export class InitDataError extends Error {}

/**
 * Перевіряє підпис initData міні-апки (HMAC-SHA256), як описано в документації Telegram:
 * secret = HMAC_SHA256(key="WebAppData", data=botToken)
 * hash   = HMAC_SHA256(key=secret, data=data_check_string)
 * Клієнту не довіряємо: без правильного підпису й свіжої дати — відмова.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSeconds?: number; now?: Date } = {},
): { user: TelegramUser; authDate: Date } {
  if (!initData) throw new InitDataError("Порожні initData");
  if (!botToken) throw new InitDataError("Не задано TELEGRAM_BOT_TOKEN");
  const maxAge = opts.maxAgeSeconds ?? 24 * 60 * 60;
  const now = opts.now ?? new Date();

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) throw new InitDataError("Немає підпису");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new InitDataError("Неправильний підпис");
  }

  const authDateSec = Number(params.get("auth_date"));
  if (!Number.isFinite(authDateSec) || authDateSec <= 0) throw new InitDataError("Немає auth_date");
  const ageSec = now.getTime() / 1000 - authDateSec;
  if (ageSec > maxAge) throw new InitDataError("initData застарілі");
  if (ageSec < -300) throw new InitDataError("auth_date у майбутньому");

  const userRaw = params.get("user");
  if (!userRaw) throw new InitDataError("Немає user");
  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new InitDataError("Пошкоджений user");
  }
  if (!user || typeof user.id !== "number") throw new InitDataError("Немає user.id");
  return { user, authDate: new Date(authDateSec * 1000) };
}

/** Для тестів: будує initData з правильним підписом. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const p = new URLSearchParams(fields);
  p.set("hash", hash);
  return p.toString();
}
