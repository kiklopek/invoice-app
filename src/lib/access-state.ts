// Jedno místo, kde se rozhoduje, kam smí kdo jít (tabulka P12 v návrhu
// procesů). Proxy, layout aplikace i onboarding volají tuhle funkci, takže
// se jejich pravidla nemohou rozejít.
//
// Proxy zná jen přihlášení a 2FA, ne členství ve firmě (to by byl dotaz do
// databáze na každé kliknutí). Ověřeného uživatele proto vede jako
// "verified"; jestli má firmu, rozhodne až layout aplikace / onboarding
// ("needs_onboarding" vs. "member").

export type AccessState =
  | "anonymous"
  | "stale_session"
  | "mfa_pending"
  | "verified"
  | "needs_onboarding"
  | "member";

export type PageKind =
  | "landing"
  | "login"
  | "signup"
  | "recovery"
  | "callback"
  | "invitation"
  | "mfa"
  | "onboarding"
  | "app"
  | "other";

export type RouteDecision =
  | { type: "show"; signOut?: true }
  | { type: "redirect"; to: string; signOut?: true };

export const LOGIN_PAGES = ["/login", "/hlavica"] as const;
export const APP_SECTIONS = ["/dashboard", "/customers", "/invoices", "/reminders", "/reports", "/settings"] as const;

function within(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function pageKind(pathname: string): PageKind {
  if (pathname === "/") return "landing";
  if ((LOGIN_PAGES as readonly string[]).includes(pathname)) return "login";
  if (pathname === "/register" || pathname === "/hlavica/registrace" || pathname === "/forgot-password") return "signup";
  if (pathname === "/reset-password") return "recovery";
  if (within(pathname, "/auth") && pathname !== "/auth") return "callback";
  if (/^\/pozvanka\/[^/]+$/.test(pathname)) return "invitation";
  if (pathname === "/mfa") return "mfa";
  if (pathname === "/onboarding") return "onboarding";
  if (APP_SECTIONS.some((section) => within(pathname, section))) return "app";
  return "other";
}

const show: RouteDecision = { type: "show" };
const redirect = (to: string, signOut = false): RouteDecision =>
  signOut ? { type: "redirect", to, signOut: true } : { type: "redirect", to };

export function routeFor(state: AccessState, pathname: string, search = ""): RouteDecision {
  const kind = pageKind(pathname);
  if (kind === "landing" || kind === "other" || kind === "callback") return show;

  switch (state) {
    case "anonymous":
      if (kind === "mfa" || kind === "onboarding") return redirect("/login");
      if (kind === "app") return redirect(`/login?returnTo=${encodeURIComponent(`${pathname}${search}`)}`);
      return show;

    case "stale_session":
      // Staré cookies bez aktivní relace prohlížeče: odhlásit vždy.
      if (kind === "login" || kind === "signup" || kind === "invitation") return { type: "show", signOut: true };
      return redirect("/login", true);

    case "mfa_pending":
      // Otevřený login je únik ze 2FA (přihlásit se jiným účtem).
      if (kind === "login") return { type: "show", signOut: true };
      if (kind === "onboarding" || kind === "app") return redirect("/mfa");
      return show;

    case "verified":
    case "member":
      if (kind === "login" || kind === "signup" || kind === "mfa") return redirect("/dashboard");
      if (kind === "onboarding" && state === "member") return redirect("/dashboard");
      return show;

    case "needs_onboarding":
      if (kind === "login" || kind === "signup" || kind === "mfa" || kind === "app") return redirect("/onboarding");
      return show;
  }
}
