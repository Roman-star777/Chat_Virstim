import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { webhookSecret } from "@/lib/bot";
import { dbService } from "@/lib/supabase";
import {
  loadContext, onEditedMessage, onGroupMessage, onMigrate, onMyChatMember, onPrivateMessage, storeFile,
} from "@/lib/bot-handlers";
import { isGroup, type TgUpdate } from "@/lib/telegram-update";

export const runtime = "nodejs";
export const maxDuration = 60;

function okSecret(got: string | null): boolean {
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(webhookSecret());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Сюди Telegram надсилає всі події бота. Перевіряємо секрет, щоб ніхто інший не міг підкинути дані. */
export async function POST(req: Request) {
  if (!okSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response("forbidden", { status: 403 });
  }
  let u: TgUpdate;
  try { u = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const db = dbService();
  try {
    const ctx = await loadContext(db);
    if (u.my_chat_member) {
      await onMyChatMember(db, ctx, u.my_chat_member);
    } else if (u.message) {
      const m = u.message;
      if (m.chat.type === "private") {
        if (!m.from?.is_bot) await onPrivateMessage(ctx, m);
      } else if (isGroup(m.chat)) {
        await onMigrate(db, ctx, m);
        if (ctx.groupChatId === m.chat.id && !m.migrate_to_chat_id) {
          const job = await onGroupMessage(db, ctx, m);
          if (job) {
            after(async () => {
              try {
                const r = await storeFile(db, job);
                console.log("file", job.file.fileName, r.status);
              } catch (e) {
                console.error("file store failed", job.file.fileName, e);
                await db.from("documents").insert({
                  tg_file_unique_id: job.file.fileUniqueId, tg_file_id: job.file.fileId, file_name: job.file.fileName,
                  mime_type: job.file.mimeType, size_bytes: job.file.size, uploaded_by: job.uploadedBy,
                  source_message_id: job.messageId, status: "error",
                });
              }
            });
          }
        }
      }
    } else if (u.edited_message && isGroup(u.edited_message.chat)) {
      await onEditedMessage(db, u.edited_message);
    }
  } catch (e) {
    // 500 → Telegram повторить пізніше; помилка видна в журналах Vercel
    console.error("webhook failed", u.update_id, e);
    return new Response("error", { status: 500 });
  }
  return new Response("ok");
}
