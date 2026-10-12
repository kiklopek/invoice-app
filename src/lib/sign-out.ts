import { clearCompanySettingsDrafts } from "@/lib/company-settings-draft";
import { resetAccessProfileCache } from "@/lib/use-access-role";

const LOGOUT_ERROR = "Odhlášení se nepodařilo. Zkontrolujte připojení a zkuste to znovu.";

function clearWorkspaceDrafts() {
  resetAccessProfileCache();
  try {
    clearCompanySettingsDrafts(window.sessionStorage);
  } catch {
    // Browser storage can be unavailable; successful logout must still finish.
  }
}

export async function signOutCurrentSession() {
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    if (response.ok) { clearWorkspaceDrafts(); return; }
  } catch {
    // Při nedostupnosti serverové routy ještě zkusíme vyčistit session v prohlížeči.
  }

  // Supabase klient pro prohlížeč je velký a potřeba je jen tady, při
  // výpadku serverové routy. Načte se až teď, ne na každé stránce.
  const { createClient, hasSupabaseBrowserConfig } = await import("@/lib/supabase-browser");
  if (hasSupabaseBrowserConfig()) {
    const supabase = createClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (!error) { clearWorkspaceDrafts(); return; }
  }

  throw new Error(LOGOUT_ERROR);
}

export async function signOutAllSessions() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "global" }),
  });
  if (!response.ok) throw new Error(LOGOUT_ERROR);
  clearWorkspaceDrafts();
}
