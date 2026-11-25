import "server-only";
import { tgCall, TgError } from "./bot";

export const BOT_USERNAME = "virstim_tasks_bot";
/** Пряме посилання на головну міні-апку бота: працює і в групах (кнопка web_app — лише в особистих). */
export const APP_LINK = `https://t.me/${BOT_USERNAME}?startapp=group`;

export async function hasMainApp(): Promise<boolean> {
  const me = await tgCall<{ has_main_web_app?: boolean }>("getMe");
  return me.has_main_web_app === true;
}

/** Надсилає в групу повідомлення з кнопкою міні-апки і (за можливості) закріплює його. */
export async function postGroupButton(chatId: number, pin: boolean) {
  const msg = await tgCall<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: "📋 Задачі, документи і працівники фірми — натисніть кнопку нижче.\nВідкрити можуть лише Роман, Сергій і Саша.",
    reply_markup: { inline_keyboard: [[{ text: "Відкрити задачі", url: APP_LINK }]] },
  });
  let pinned = false;
  let pinError: string | undefined;
  if (pin) {
    try {
      await tgCall("pinChatMessage", { chat_id: chatId, message_id: msg.message_id, disable_notification: true });
      pinned = true;
    } catch (e) {
      pinError = e instanceof TgError ? e.description : String(e);
    }
  }
  return { messageId: msg.message_id, pinned, pinError };
}
