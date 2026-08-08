import { createBrowserClient } from "@supabase/ssr";

// Klient slouží pouze pro Supabase Auth. Aplikační zápisy chodí přes serverové
// routy; databáze navíc odebírá klientským rolím přímá práva zápisu.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export function hasSupabaseBrowserConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
