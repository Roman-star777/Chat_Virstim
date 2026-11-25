import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задано ${name}`);
  return v;
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Клієнт від імені члена команди: усі запити проходять через RLS. */
export function dbAsMember(token: string): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    ...opts,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Службовий клієнт (обходить RLS). Лише для входу, привʼязки людей, бота й планувальника. */
export function dbService(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), opts);
}
