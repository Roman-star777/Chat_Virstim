import { describe, expect, it } from "vitest";
import { addDays, dueLabel, endOfWeek, longDate, nextFriday, todayInTz } from "@/lib/dates";

describe("дати за Прагою", () => {
  it("сьогодні рахується за Прагою, а не за UTC", () => {
    // 23:30 UTC 25.11 = 00:30 26.11 у Празі (зима, UTC+1)
    expect(todayInTz("Europe/Prague", new Date("2026-11-25T23:30:00Z"))).toBe("2026-11-26");
    // влітку UTC+2: 22:30 UTC 30.06 = 00:30 01.07
    expect(todayInTz("Europe/Prague", new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    expect(todayInTz("Europe/Prague", new Date("2026-11-25T10:00:00Z"))).toBe("2026-11-25");
  });

  it("додавання днів через межу місяця і року", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30"); // перехід на літній час
  });

  it("кнопка «Пʼятниця»", () => {
    expect(nextFriday("2026-11-25")).toBe("2026-11-27"); // середа → ця пʼятниця
    expect(nextFriday("2026-11-27")).toBe("2026-11-27"); // пʼятниця → сьогодні
    expect(nextFriday("2026-11-28")).toBe("2026-12-04"); // субота → наступна
    expect(nextFriday("2026-11-29")).toBe("2026-12-04"); // неділя → наступна
  });

  it("кінець тижня — неділя", () => {
    expect(endOfWeek("2026-11-23")).toBe("2026-11-29");
    expect(endOfWeek("2026-11-29")).toBe("2026-11-29");
  });

  it("підписи терміну як у макеті", () => {
    const today = "2026-11-25";
    expect(dueLabel("2026-11-25", today)).toBe("сьогодні");
    expect(dueLabel("2026-11-26", today)).toBe("завтра");
    expect(dueLabel("2026-11-22", today)).toBe("було 22 лист.");
    expect(dueLabel("2026-11-28", today)).toBe("28 лист.");
    expect(dueLabel(null, today)).toBe("без терміну");
    expect(longDate(today)).toBe("Середа, 25 листопада");
  });
});
