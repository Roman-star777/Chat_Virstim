/** Розбір оновлень Telegram без мережі й бази (щоб легко тестувати). */

export type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
export type TgChat = { id: number; type: "private" | "group" | "supergroup" | "channel"; title?: string };
type Sized = { file_id: string; file_unique_id: string; file_size?: number };
export type TgMessage = {
  message_id: number;
  date: number;
  edit_date?: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
  document?: Sized & { file_name?: string; mime_type?: string };
  photo?: Sized[];
  video?: Sized & { file_name?: string; mime_type?: string };
  audio?: Sized & { file_name?: string; mime_type?: string };
  migrate_to_chat_id?: number;
  new_chat_members?: TgUser[];
  left_chat_member?: TgUser;
};
export type TgChatMemberUpdated = {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: { status: string; user: TgUser };
  new_chat_member: { status: string; user: TgUser };
};
export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  my_chat_member?: TgChatMemberUpdated;
};

export const MAX_BOT_DOWNLOAD = 20 * 1024 * 1024;

export type IncomingFile = {
  fileId: string;
  fileUniqueId: string;
  fileName: string;
  mimeType: string | null;
  size: number | null;
};

function ts(unix: number): string {
  return new Date(unix * 1000).toISOString();
}

/** Файл із повідомлення: документ, фото (найбільше), відео, аудіо. Голосові й стікери не збираємо. */
export function extractFile(m: TgMessage): IncomingFile | null {
  if (m.document) {
    return {
      fileId: m.document.file_id, fileUniqueId: m.document.file_unique_id,
      fileName: m.document.file_name || `file-${m.message_id}`, mimeType: m.document.mime_type ?? null, size: m.document.file_size ?? null,
    };
  }
  if (m.photo?.length) {
    const p = [...m.photo].sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0];
    return {
      fileId: p.file_id, fileUniqueId: p.file_unique_id,
      fileName: `photo-${ts(m.date).slice(0, 10)}-${m.message_id}.jpg`, mimeType: "image/jpeg", size: p.file_size ?? null,
    };
  }
  for (const [kind, f] of [["video", m.video], ["audio", m.audio]] as const) {
    if (f) {
      return {
        fileId: f.file_id, fileUniqueId: f.file_unique_id,
        fileName: f.file_name || `${kind}-${m.message_id}`, mimeType: f.mime_type ?? null, size: f.file_size ?? null,
      };
    }
  }
  return null;
}

/** Рядок для chat_messages. */
export function messageRow(m: TgMessage, memberByTgId: Map<number, string>) {
  const file = extractFile(m);
  return {
    tg_chat_id: m.chat.id,
    tg_message_id: m.message_id,
    from_tg_user_id: m.from?.id ?? null,
    from_member_id: m.from ? memberByTgId.get(m.from.id) ?? null : null,
    text: (m.text ?? m.caption ?? null)?.slice(0, 10000) ?? null,
    sent_at: ts(m.date),
    reply_to_tg_message_id: m.reply_to_message?.message_id ?? null,
    has_file: file !== null,
  };
}

/** Безпечна назва для сховища: латиниця, цифри, крапка, дефіс. */
export function storageName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) : "";
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "file";
  return ext ? `${base}.${ext}` : base;
}

export function isGroup(chat: TgChat): boolean {
  return chat.type === "group" || chat.type === "supergroup";
}

/** Бот став учасником/адміном групи (додали) чи вийшов/вигнали. */
export function botMembershipChange(u: TgChatMemberUpdated): "added" | "removed" | "promoted" | "demoted" | null {
  const was = u.old_chat_member.status;
  const now = u.new_chat_member.status;
  const inside = (s: string) => s === "member" || s === "administrator" || s === "restricted";
  if (!inside(was) && inside(now)) return "added";
  if (inside(was) && !inside(now)) return "removed";
  if (was !== "administrator" && now === "administrator") return "promoted";
  if (was === "administrator" && now !== "administrator") return "demoted";
  return null;
}
