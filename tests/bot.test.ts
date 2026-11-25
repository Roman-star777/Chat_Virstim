import { describe, expect, it } from "vitest";
import { hourInTz, planReminders, reminderText, type RemMember, type RemTask } from "@/lib/reminders";
import { botMembershipChange, extractFile, messageRow, storageName, type TgMessage } from "@/lib/telegram-update";
import { webhookSecret } from "@/lib/bot";

const members: RemMember[] = [
  { id: "r", name: "Роман", tg_user_id: 1, active: true },
  { id: "s", name: "Сергій", tg_user_id: null, active: true },
  { id: "a", name: "Саша", tg_user_id: 3, active: true },
];
const S = { remind_day_before: true, remind_due_today: true, remind_overdue: true };
const task = (p: Partial<RemTask>): RemTask => ({
  id: "t", title: "Задача", assignee_kind: "person", assignee_id: "r", due_date: "2026-11-25",
  status: "open", remind: true, important: false, completions: [], ...p,
});

describe("план нагадувань", () => {
  const today = "2026-11-25";
  it("за день, у день, прострочені", () => {
    const p = planReminders([
      task({ id: "1", due_date: "2026-11-26" }),
      task({ id: "2", due_date: "2026-11-25" }),
      task({ id: "3", due_date: "2026-11-20" }),
      task({ id: "4", due_date: "2026-11-28" }),
    ], members, today, S);
    expect(p.map((x) => `${x.taskId}:${x.kind}`)).toEqual(["1:day_before", "2:due_today", "3:overdue"]);
    expect(p.every((x) => x.forDate === today)).toBe(true);
  });
  it("без «Нагадати», виконані й без терміну — пропускаються", () => {
    expect(planReminders([
      task({ remind: false }), task({ status: "done" }), task({ due_date: null }),
    ], members, today, S)).toEqual([]);
  });
  it("«Усі»: лише ті, хто ще не поставив галочку", () => {
    const [p] = planReminders([task({ assignee_kind: "all", assignee_id: null, completions: ["r"] })], members, today, S);
    expect(p.memberIds).toEqual(["s", "a"]);
  });
  it("вимкнені в налаштуваннях види не надсилаються", () => {
    expect(planReminders([task({ due_date: "2026-11-20" })], members, today, { ...S, remind_overdue: false })).toEqual([]);
  });
  it("текст: розділи і екранування", () => {
    const t = reminderText([
      { task: task({ title: "Сплатити <ДПH> & звіт", important: true }), kind: "due_today" },
      { task: task({ title: "Старе", due_date: "2026-11-20" }), kind: "overdue" },
    ], "Саша");
    expect(t).toContain("<b>Саша</b>");
    expect(t.indexOf("Прострочено")).toBeLessThan(t.indexOf("Сьогодні"));
    expect(t).toContain("❗ Сплатити &lt;ДПH&gt; &amp; звіт");
    expect(t).toContain("термін був 20 лист.");
  });
  it("година за Прагою: зима UTC+1, літо UTC+2", () => {
    expect(hourInTz("Europe/Prague", new Date("2026-11-25T08:00:00Z"))).toBe(9);
    expect(hourInTz("Europe/Prague", new Date("2026-07-01T07:00:00Z"))).toBe(9);
    expect(hourInTz("Europe/Prague", new Date("2026-11-25T23:30:00Z"))).toBe(0);
  });
});

describe("розбір повідомлень Telegram", () => {
  const base: TgMessage = { message_id: 7, date: 1795600000, chat: { id: -100, type: "supergroup" }, from: { id: 1 } };
  it("документ, фото (найбільше), без файлу", () => {
    expect(extractFile({ ...base, document: { file_id: "f", file_unique_id: "u", file_name: "Faktura 11.pdf", mime_type: "application/pdf", file_size: 1000 } }))
      .toEqual({ fileId: "f", fileUniqueId: "u", fileName: "Faktura 11.pdf", mimeType: "application/pdf", size: 1000 });
    const ph = extractFile({ ...base, photo: [{ file_id: "s", file_unique_id: "1", file_size: 10 }, { file_id: "b", file_unique_id: "2", file_size: 900 }] });
    expect(ph?.fileId).toBe("b");
    expect(ph?.fileName).toMatch(/^photo-\d{4}-\d{2}-\d{2}-7\.jpg$/);
    expect(extractFile({ ...base, text: "привіт" })).toBeNull();
  });
  it("рядок повідомлення: підпис до файлу як текст, хто написав", () => {
    const r = messageRow({ ...base, caption: "рахунок", document: { file_id: "f", file_unique_id: "u" } }, new Map([[1, "r"]]));
    expect(r).toMatchObject({ tg_chat_id: -100, tg_message_id: 7, from_member_id: "r", text: "рахунок", has_file: true });
    expect(messageRow({ ...base, from: { id: 99 }, text: "x" }, new Map()).from_member_id).toBeNull();
  });
  it("безпечна назва файлу", () => {
    expect(storageName("Faktura č. 11 / листопад.PDF")).toBe("Faktura-c-11.pdf");
    expect(storageName("../../etc/passwd")).not.toContain("/");
    expect(storageName("Договір.docx")).toBe("file.docx");
  });
  it("зміна статусу бота в групі", () => {
    const u = (was: string, now: string) => ({ chat: base.chat, from: { id: 1 }, date: 0, old_chat_member: { status: was, user: { id: 2 } }, new_chat_member: { status: now, user: { id: 2 } } });
    expect(botMembershipChange(u("left", "member"))).toBe("added");
    expect(botMembershipChange(u("left", "administrator"))).toBe("added");
    expect(botMembershipChange(u("member", "administrator"))).toBe("promoted");
    expect(botMembershipChange(u("administrator", "kicked"))).toBe("removed");
  });
  it("секрет вебхука стабільний і залежить від токена", () => {
    expect(webhookSecret("123:abc")).toBe(webhookSecret("123:abc"));
    expect(webhookSecret("123:abc")).not.toBe(webhookSecret("123:abd"));
    expect(webhookSecret("123:abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});
