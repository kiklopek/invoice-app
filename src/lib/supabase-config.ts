/** Safe to import in forms without eagerly loading the authentication SDK. */
export function hasSupabaseBrowserConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/** Warm the module on form interaction; importing it does not establish a session. */
export function preloadSupabaseBrowserClient() {
  void import("@/lib/supabase-browser").catch(() => {
    // The explicit import on submit can retry if connectivity was interrupted.
  });
}
