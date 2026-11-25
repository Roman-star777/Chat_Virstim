import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "./dates";
import { isMonth } from "./employees";

/** Місяць із запиту, або останній місяць із годинами (не пізніше поточного), або поточний. */
export async function resolveMonth(db: SupabaseClient, requested: string | null): Promise<string> {
  if (isMonth(requested)) return requested;
  const current = todayInTz().slice(0, 7);
  const { data } = await db.from("employee_hours").select("month").lte("month", `${current}-01`)
    .order("month", { ascending: false }).limit(1);
  const latest = data?.[0]?.month ? String(data[0].month).slice(0, 7) : null;
  return latest ?? current;
}
