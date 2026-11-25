import { describe, expect, it } from "vitest";
import { signInitData, verifyInitData } from "@/lib/telegram";

const TOKEN = "123456:TEST_TOKEN";
const now = new Date("2026-11-25T10:00:00Z");
const authDate = String(Math.floor(now.getTime() / 1000) - 60);
const user = JSON.stringify({ id: 111, first_name: "Роман", username: "roman" });

describe("перевірка initData Telegram", () => {
  it("приймає правильно підписані дані", () => {
    const init = signInitData({ auth_date: authDate, query_id: "AAA", user }, TOKEN);
    const r = verifyInitData(init, TOKEN, { now });
    expect(r.user.id).toBe(111);
    expect(r.user.first_name).toBe("Роман");
  });

  it("перевіряє з полем signature (нові клієнти Telegram)", () => {
    const init = signInitData({ auth_date: authDate, user, signature: "abc" }, TOKEN);
    expect(verifyInitData(init, TOKEN, { now }).user.id).toBe(111);
  });

  it("відкриття з групи (пряме посилання): та сама перевірка, людина — з user", () => {
    const init = signInitData({ auth_date: authDate, user, chat_instance: "-5555", chat_type: "group", start_param: "group", signature: "abc" }, TOKEN);
    expect(verifyInitData(init, TOKEN, { now }).user.id).toBe(111);
  });

  it("відхиляє підпис іншим токеном", () => {
    const init = signInitData({ auth_date: authDate, user }, "999:OTHER");
    expect(() => verifyInitData(init, TOKEN, { now })).toThrow("Неправильний підпис");
  });

  it("відхиляє підмінений user_id", () => {
    const init = signInitData({ auth_date: authDate, user }, TOKEN);
    const forged = init.replace(encodeURIComponent('"id":111'), encodeURIComponent('"id":222'));
    expect(forged).not.toBe(init);
    expect(() => verifyInitData(forged, TOKEN, { now })).toThrow("Неправильний підпис");
  });

  it("відхиляє застарілі дані (старші за добу)", () => {
    const old = String(Math.floor(now.getTime() / 1000) - 25 * 3600);
    const init = signInitData({ auth_date: old, user }, TOKEN);
    expect(() => verifyInitData(init, TOKEN, { now })).toThrow("застарілі");
  });

  it("відхиляє дані без підпису і порожні", () => {
    expect(() => verifyInitData(`auth_date=${authDate}&user=${encodeURIComponent(user)}`, TOKEN, { now })).toThrow("Немає підпису");
    expect(() => verifyInitData("", TOKEN, { now })).toThrow();
  });

  it("не працює без токена бота", () => {
    const init = signInitData({ auth_date: authDate, user }, TOKEN);
    expect(() => verifyInitData(init, "", { now })).toThrow("TELEGRAM_BOT_TOKEN");
  });
});
