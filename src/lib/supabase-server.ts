import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Chybí proměnná prostředí ${name}.`);
  return value;
}

export function createServiceClient() {
  return createSupabaseClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function createUserServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components nemohou zapisovat cookies; middleware session obnovuje.
          }
        },
      },
    }
  );
}

export function isDemoMode() {
  // Lokální vývoj bez Supabase používá ukázková data. Produkční sestavení
  // nesmí vracet demo data ani obcházet autentizaci za žádných okolností.
  return process.env.NODE_ENV !== "production" && Boolean(
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// PostgreSQL function arguments can accept SQL NULL even though generated
// Supabase function types currently expose non-defaulted text/timestamp args as
// plain strings. Keep the escape hatch centralized and visible.
export function nullableRpcString(value: string | null) {
  return value as string;
}
