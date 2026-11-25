import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appUrl, tgCall, tgDownload } from "./bot";
import { hasMainApp, postGroupButton, BOT_USERNAME } from "./group-button";
import {
  MAX_BOT_DOWNLOAD, botMembershipChange, extractFile, isGroup, messageRow, storageName,
  type TgChatMemberUpdated, type TgMessage,
} from "./telegram-update";

type Member = { id: string; name: string; tg_user_id: number | null; can_manage_employees: boolean };

export async function loadContext(db: SupabaseClient) {
  const [members, settings] = await Promise.all([
    db.from("members").select("id, name, tg_user_id, can_manage_employees").eq("active", true),
    db.from("settings").select("group_chat_id, ai_notice_sent_at").single(),
  ]);
  if (members.error) throw members.error;
  if (settings.error) throw settings.error;
  const list = (members.data ?? []) as Member[];
  const byTg = new Map(list.filter((m) => m.tg_user_id !== null).map((m) => [Number(m.tg_user_id), m]));
  return { members: list, byTg, groupChatId: settings.data.group_chat_id as number | null, noticeSent: !!settings.data.ai_notice_sent_at };
}
type Ctx = Awaited<ReturnType<typeof loadContext>>;

const NOTICE = [
  "Привіт! Я бот задач і документів фірми.",
  "",
  "Що я роблю в цій групі:",
  "• зберігаю повідомлення і файли (документи, фото) у закритій базі фірми. Доступ мають лише Роман, Сергій і Саша;",
  "• нагадую про задачі в особистих повідомленнях о 9:00.",
  "",
  "Пізніше документи розбиратиме штучний інтелект Claude (Anthropic), щоб розкласти їх за категоріями. Дані працівників туди не надсилаються.",
].join("\n");

/** Бота додали/прибрали з групи. Прийняти групу може лише Роман або Сергій. */
export async function onMyChatMember(db: SupabaseClient, ctx: Ctx, u: TgChatMemberUpdated) {
  if (!isGroup(u.chat)) return;
  const change = botMembershipChange(u);
  const by = ctx.byTg.get(u.from.id);

  if (change === "added") {
    if (!by?.can_manage_employees) {
      await tgCall("sendMessage", { chat_id: u.chat.id, text: "Цього бота може додати в групу лише Роман або Сергій. Виходжу." }).catch(() => {});
      await tgCall("leaveChat", { chat_id: u.chat.id });
      return;
    }
    if (ctx.groupChatId && ctx.groupChatId !== u.chat.id) {
      await tgCall("sendMessage", { chat_id: u.chat.id, text: "Я вже працюю в іншій групі фірми. Щоб перейти сюди, спершу приберіть мене з тієї групи." }).catch(() => {});
      await tgCall("leaveChat", { chat_id: u.chat.id });
      return;
    }
    const { error } = await db.from("settings").update({ group_chat_id: u.chat.id }).eq("id", 1);
    if (error) throw error;
    await sendNotice(db, u.chat.id, u.new_chat_member.status === "administrator");
    return;
  }

  if (change === "removed" && ctx.groupChatId === u.chat.id) {
    const { error } = await db.from("settings").update({ group_chat_id: null }).eq("id", 1);
    if (error) throw error;
    return;
  }

  if (change === "promoted" && ctx.groupChatId === u.chat.id) {
    await tgCall("sendMessage", { chat_id: u.chat.id, text: "Дякую! Тепер я бачу всі повідомлення групи." });
  }
}

async function sendNotice(db: SupabaseClient, chatId: number, isAdmin: boolean) {
  const me = await tgCall<{ can_read_all_group_messages?: boolean }>("getMe");
  const sees = isAdmin || me.can_read_all_group_messages === true;
  const tail = sees ? "" : "\n\n⚠️ Щоб я бачив усі повідомлення і файли, зробіть мене адміністратором групи (Налаштування групи → Адміністратори → Додати). Права можна залишити мінімальні.";
  await tgCall("sendMessage", { chat_id: chatId, text: NOTICE + tail });
  await db.from("settings").update({ ai_notice_sent_at: new Date().toISOString() }).eq("id", 1);
}

/** Звичайна група стала супергрупою: Telegram міняє її номер. */
export async function onMigrate(db: SupabaseClient, ctx: Ctx, m: TgMessage) {
  if (m.migrate_to_chat_id && ctx.groupChatId === m.chat.id) {
    const { error } = await db.from("settings").update({ group_chat_id: m.migrate_to_chat_id }).eq("id", 1);
    if (error) throw error;
    ctx.groupChatId = m.migrate_to_chat_id;
  }
}

/** Повідомлення з групи фірми: зберегти текст; файл — поставити в чергу на скачування. */
export async function onGroupMessage(db: SupabaseClient, ctx: Ctx, m: TgMessage) {
  const memberIds = new Map([...ctx.byTg].map(([k, v]) => [k, v.id]));
  const row = messageRow(m, memberIds);
  const { data, error } = await db.from("chat_messages")
    .upsert(row, { onConflict: "tg_chat_id,tg_message_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  const messageId = data?.[0]?.id as string | undefined;
  if (!messageId) return null; // уже було (Telegram повторив)
  const file = extractFile(m);
  return file ? { messageId, file, uploadedBy: row.from_member_id } : null;
}

export async function onEditedMessage(db: SupabaseClient, m: TgMessage) {
  const { error } = await db.from("chat_messages")
    .update({ text: (m.text ?? m.caption ?? null)?.slice(0, 10000) ?? null, edited_at: new Date((m.edit_date ?? m.date) * 1000).toISOString() })
    .eq("tg_chat_id", m.chat.id).eq("tg_message_id", m.message_id);
  if (error) throw error;
}

/** Скачує файл із Telegram у приватне сховище (документи/РРРР/ММ/хеш-назва). Однакові файли не дублюються. */
export async function storeFile(db: SupabaseClient, job: NonNullable<Awaited<ReturnType<typeof onGroupMessage>>>) {
  const { file } = job;
  const base = {
    tg_file_unique_id: file.fileUniqueId, tg_file_id: file.fileId, file_name: file.fileName,
    mime_type: file.mimeType, size_bytes: file.size, uploaded_by: job.uploadedBy, source_message_id: job.messageId,
  };
  if (file.size !== null && file.size > MAX_BOT_DOWNLOAD) {
    const { error } = await db.from("documents").insert({ ...base, status: "too_large" });
    if (error) throw error;
    return { status: "too_large" as const };
  }
  const { bytes } = await tgDownload(file.fileId);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const { data: dup } = await db.from("documents").select("id").eq("sha256", sha).maybeSingle();
  if (dup) return { status: "duplicate" as const, id: dup.id as string };

  const now = new Date();
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${sha.slice(0, 16)}-${storageName(file.fileName)}`;
  const up = await db.storage.from("documents").upload(path, bytes, { contentType: file.mimeType ?? "application/octet-stream", upsert: false });
  if (up.error && !/exists/i.test(up.error.message)) throw up.error;
  const { data, error } = await db.from("documents")
    .insert({ ...base, sha256: sha, size_bytes: bytes.length, storage_path: path, status: "queued" })
    .select("id").single();
  if (error) {
    if (error.code === "23505") return { status: "duplicate" as const };
    throw error;
  }
  return { status: "stored" as const, id: data.id as string, path };
}

/** Особисті повідомлення боту: підказка і кнопка міні-апки. */
export async function onPrivateMessage(ctx: Ctx, m: TgMessage) {
  const known = m.from ? ctx.byTg.get(m.from.id) : undefined;
  const text = known
    ? `Вітаю, ${known.name}! Сюди я надсилатиму нагадування про задачі. Задачі й документи відкриваються кнопкою нижче.`
    : "Це бот фірми для задач і документів. Щоб отримати доступ, відкрийте міні-апку кнопкою нижче: Роман або Сергій підтвердять вас.";
  await tgCall("sendMessage", {
    chat_id: m.chat.id,
    text,
    reply_markup: { inline_keyboard: [[{ text: "Відкрити задачі", web_app: { url: appUrl() } }]] },
  });
}

/** Команда /tasks у групі: бот надсилає кнопку міні-апки. */
export function isTasksCommand(m: TgMessage): boolean {
  const t = (m.text ?? "").trim().toLowerCase();
  return t === "/tasks" || t === `/tasks@${BOT_USERNAME}` || t === "/app" || t === `/app@${BOT_USERNAME}`;
}

export async function onTasksCommand(m: TgMessage) {
  if (!(await hasMainApp())) {
    await tgCall("sendMessage", { chat_id: m.chat.id, text: "Кнопка ще не налаштована: Роману треба увімкнути міні-апку в BotFather." });
    return;
  }
  await postGroupButton(m.chat.id, false);
}
