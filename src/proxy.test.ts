import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// proxy.ts je 270 řádků autorizace, na které stojí přístup do celé aplikace,
// a nemělo jediný test. Testuje se tu rozhodování, ne Supabase: klient je
// zmockovaný, takže každý scénář jde nastavit přesně.

const authState = {
  claims: null as { sub: string; email: string; session_id?: string } | null,
  user: null as { id: string; email: string } | null,
  signOutCalls: 0,
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({
        data: authState.claims ? { claims: authState.claims } : null,
        error: authState.claims ? null : new Error("no claims"),
      }),
      getUser: async () => ({
        data: { user: authState.user },
        error: authState.user ? null : new Error("no user"),
      }),
      signOut: async () => {
        authState.signOutCalls += 1;
      },
    },
  }),
}));

const ORIGINAL_ENV = { ...process.env };

function request(path: string, cookies: Record<string, string> = {}) {
  const next = new NextRequest(new URL(`https://app.example${path}`));
  for (const [name, value] of Object.entries(cookies)) next.cookies.set(name, value);
  return next;
}

const locationOf = (response: Response) => response.headers.get("location") ?? "";

// Staré Supabase cookies samy o sobě proxy nestačí: bez podepsané session
// uživatele odhlásí ještě před kontrolou domény a MFA. Token se proto vyrábí
// skutečnou funkcí, ne napodobeninou -- jinak by test ověřoval fikci.
async function signedInCookies(userId: string, sessionId: string) {
  const { createLoginSessionToken, LOGIN_SESSION_COOKIE } = await import("./lib/login-session");
  return {
    [LOGIN_SESSION_COOKIE]: createLoginSessionToken({
      userId,
      sessionId,
      remember: false,
      secret: process.env.EMAIL_MFA_SECRET,
    }),
  };
}

beforeEach(() => {
  authState.claims = null;
  authState.user = null;
  authState.signOutCalls = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.EMAIL_MFA_SECRET = "test-secret-with-at-least-32-characters!!";
  process.env.LOGIN_SESSION_SECRET = "login-secret-with-at-least-32-chars!!!";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

async function runProxy(path: string, cookies?: Record<string, string>) {
  const { proxy } = await import("./proxy");
  return proxy(request(path, cookies));
}

describe("bez konfigurace Supabase", () => {
  // Chybějící konfigurace nesmí být cesta, jak se dostat dovnitř.
  it("never lets a protected page through", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const response = await runProxy("/dashboard");
    expect(response.status).toBe(307);
    expect(locationOf(response)).toContain("/login");
  });

  it("still serves the login page, so the user can see what is wrong", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const response = await runProxy("/login");
    expect(response.status).toBe(200);
  });
});

describe("nepřihlášený uživatel", () => {
  it("is redirected to login from every workspace section", async () => {
    for (const path of ["/dashboard", "/customers", "/invoices", "/reports", "/settings", "/reminders"]) {
      const response = await runProxy(path);
      expect(locationOf(response), path).toContain("/login");
    }
  });

  // /customers dřív v matcheru chybělo, takže uživatel místo přihlášení
  // spadl do obecné chybové stránky s tlačítkem, které vedlo na tutéž chybu.
  it("remembers where it was heading", async () => {
    expect(locationOf(await runProxy("/customers"))).toContain("returnTo=%2Fcustomers");
    expect(locationOf(await runProxy("/invoices/archive"))).toContain("returnTo=%2Finvoices%2Farchive");
  });

  it("keeps public pages public", async () => {
    for (const path of ["/login", "/register", "/forgot-password", "/reset-password"]) {
      expect((await runProxy(path)).status, path).toBe(200);
    }
  });
});

describe("cizí e-mailová doména", () => {
  it("is signed out instead of being let in", async () => {
    authState.claims = { sub: "user-1", email: "utocnik@jinadomena.cz", session_id: "s1" };
    authState.user = { id: "user-1", email: "utocnik@jinadomena.cz" };
    const cookies = await signedInCookies("user-1", "s1");
    const previous = process.env.NODE_ENV;
    // Doménová politika platí jen v produkčním režimu.
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
    const response = await runProxy("/dashboard", cookies);
    Object.defineProperty(process.env, "NODE_ENV", { value: previous, configurable: true });
    expect(locationOf(response)).toContain("error=domain");
    expect(authState.signOutCalls).toBe(1);
  });
});

describe("dvoufázové ověření", () => {
  it("sends a signed-in user without MFA to the verification step", async () => {
    authState.claims = { sub: "user-1", email: "ucetni@hlavica.cz", session_id: "s1" };
    authState.user = { id: "user-1", email: "ucetni@hlavica.cz" };
    expect(locationOf(await runProxy("/dashboard", await signedInCookies("user-1", "s1")))).toContain("/mfa");
  });

  it("does not bounce the verification page itself into a loop", async () => {
    authState.claims = { sub: "user-1", email: "ucetni@hlavica.cz", session_id: "s1" };
    authState.user = { id: "user-1", email: "ucetni@hlavica.cz" };
    // Uživatel bez dokončeného MFA má na /mfa zůstat, ne se odsud přesměrovat.
    const response = await runProxy("/mfa", await signedInCookies("user-1", "s1"));
    expect(response.status).toBe(200);
  });

  // Jediná pevná výjimka; kdyby přestala platit, testovací účet by se
  // zacyklil mezi /mfa a /dashboard a e2e sada by ztratila session.
  it("lets the one trusted account straight through", async () => {
    authState.claims = { sub: "user-1", email: "test-admin@hlavica.cz", session_id: "s1" };
    authState.user = { id: "user-1", email: "test-admin@hlavica.cz" };
    // Projde rovnou: žádné přesměrování, tedy ani na /mfa, ani na /login.
    const response = await runProxy("/dashboard", await signedInCookies("user-1", "s1"));
    expect(response.status).toBe(200);
    expect(locationOf(response)).toBe("");
  });
});
