import { shiftMonth } from "./employees";

export const REPORT_DAY = 10;
/** Якщо 10-го запуск не вдався, до 15-го ще дозвідправляємо. */
export const REPORT_CATCHUP_UNTIL = 15;

/** За який місяць треба надіслати список (YYYY-MM), або null, якщо сьогодні не час. today — дата за Прагою. */
export function monthlyReportDue(today: string, hour: number, sendHour: number): string | null {
  const day = Number(today.slice(8, 10));
  if (day < REPORT_DAY || day > REPORT_CATCHUP_UNTIL) return null;
  if (day === REPORT_DAY && hour < sendHour) return null;
  return shiftMonth(today.slice(0, 7), -1);
}
