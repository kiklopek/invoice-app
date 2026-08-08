import { createClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";

const LOGOUT_ERROR = "Odhlášení se nepodařilo. Zkontrolujte připojení a zkuste to znovu.";

export async function signOutCurrentSession() {
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    if (response.ok) return;
  } catch {
    // Při nedostupnosti serverové routy ještě zkusíme vyčistit session v prohlížeči.
  }

  if (hasSupabaseBrowserConfig()) {
    const supabase = createClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (!error) return;
  }

  throw new Error(LOGOUT_ERROR);
}
