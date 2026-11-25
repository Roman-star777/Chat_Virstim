import "server-only";
import { createHmac } from "node:crypto";

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("Не задано TELEGRAM_BOT_TOKEN");
  return t;
}

/** Секрет вебхука виводиться з токена бота, тому окрема змінна не потрібна. */
export function webhookSecret(botToken: string = token()): string {
  return createHmac("sha256", botToken).update("virstim-webhook-v1").digest("hex");
}

export class TgError extends Error {
  constructor(public method: string, public code: number, public description: string) {
    super(`Telegram ${method}: ${code} ${description}`);
  }
}

/** Виклик Telegram Bot API. Помилки не ховаються: кидає TgError. */
export async function tgCall<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; error_code?: number; description?: string };
  if (!body.ok) throw new TgError(method, body.error_code ?? res.status, body.description ?? "невідома помилка");
  return body.result as T;
}

/** Скачує файл, отриманий ботом (Telegram дозволяє ботам до 20 МБ). */
export async function tgDownload(fileId: string): Promise<{ bytes: Buffer; path: string }> {
  const f = await tgCall<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!f.file_path) throw new Error("Telegram не дав шлях до файлу");
  const res = await fetch(`https://api.telegram.org/file/bot${token()}/${f.file_path}`);
  if (!res.ok) throw new Error(`Не вдалося скачати файл: ${res.status}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), path: f.file_path };
}

export function appUrl(): string {
  return process.env.APP_URL ?? "https://chat-virstim.vercel.app";
}

/** Перевіряє, що Telegram надсилає оновлення саме на наш вебхук; якщо ні — налаштовує. */
export async function ensureWebhook(): Promise<{ changed: boolean; url: string; pending: number; lastError?: string }> {
  const url = `${appUrl()}/api/telegram/webhook`;
  const info = await tgCall<{ url: string; pending_update_count: number; last_error_message?: string }>("getWebhookInfo");
  if (info.url === url) return { changed: false, url, pending: info.pending_update_count, lastError: info.last_error_message };
  await tgCall("setWebhook", {
    url,
    secret_token: webhookSecret(),
    allowed_updates: ["message", "edited_message", "my_chat_member", "callback_query"],
    max_connections: 10,
  });
  return { changed: true, url, pending: info.pending_update_count };
}
