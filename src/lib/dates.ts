/** Дати як рядки YYYY-MM-DD у часовому поясі фірми (Europe/Prague). */

export const FIRM_TZ = "Europe/Prague";

export function todayInTz(tz: string = FIRM_TZ, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function toUtcNoon(d: string): Date {
  return new Date(`${d}T12:00:00Z`);
}

export function addDays(d: string, n: number): string {
  const x = toUtcNoon(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** 0 = неділя … 6 = субота */
export function weekday(d: string): number {
  return toUtcNoon(d).getUTCDay();
}

/** Неділя поточного тижня (тиждень пн–нд). */
export function endOfWeek(d: string): string {
  const wd = weekday(d);
  return addDays(d, wd === 0 ? 0 : 7 - wd);
}

/** Кнопка «Пʼятниця»: ця пʼятниця; якщо сьогодні субота чи неділя — наступна. */
export function nextFriday(d: string): string {
  const wd = weekday(d);
  const diff = (5 - wd + 7) % 7;
  return addDays(d, diff);
}

const MONTHS = ["січ.", "лют.", "бер.", "квіт.", "трав.", "черв.", "лип.", "серп.", "вер.", "жовт.", "лист.", "груд."];
const WEEKDAYS = ["Неділя", "Понеділок", "Вівторок", "Середа", "Четвер", "Пʼятниця", "Субота"];
const MONTHS_FULL = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];

export function shortDate(d: string): string {
  return `${Number(d.slice(8, 10))} ${MONTHS.at(Number(d.slice(5, 7)) - 1)}`;
}

/** «Вівторок, 25 листопада» */
export function longDate(d: string): string {
  return `${WEEKDAYS.at(weekday(d))}, ${Number(d.slice(8, 10))} ${MONTHS_FULL.at(Number(d.slice(5, 7)) - 1)}`;
}

/** Підпис терміну в рядку задачі, як у макеті. */
export function dueLabel(due: string | null, today: string): string {
  if (!due) return "без терміну";
  if (due === today) return "сьогодні";
  if (due === addDays(today, 1)) return "завтра";
  if (due < today) return `було ${shortDate(due)}`;
  return shortDate(due);
}
