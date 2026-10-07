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

async function verifiedCookies(userId: string, sessionId: string) {
  const { createEmailMfaToken, EMAIL_MFA_COOKIE } = await import("./lib/email-mfa-core");
  return {
    ...(await signedInCookies(userId, sessionId)),
    [EMAIL_MFA_COOKIE]: createEmailMfaToken({ userId, sessionId, secret: process.env.EMAIL_MFA_SECRET! }),
  };
}

// Splatno je pro všechny firmy. Doménu hlídá firma při pozvání, ne proxy:
// člověk z jiné firmy se dostane jen ke svým datům (oddělení dělá
// organization_id), takže ho proxy nesmí vyhodit jen kvůli doméně.
describe("e-mail mimo hlavica.cz", () => {
  it("is let into the application once fully verified", async () => {
    authState.claims = { sub: "user-1", email: "jan@novafirma.cz", session_id: "s1" };
    authState.user = { id: "user-1", email: "jan@novafirma.cz" };
    const previous = process.env.NODE_ENV;
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
    const response = await runProxy("/dashboard", await verifiedCookies("user-1", "s1"));
    Object.defineProperty(process.env, "NODE_ENV", { value: previous, configurable: true });
    expect(response.status).toBe(200);
    expect(locationOf(response)).toBe("");
    expect(authState.signOutCalls).toBe(0);
  });
});

describe("onboarding a pozvánky", () => {
  it("never shows onboarding to an anonymous visitor", async () => {
    expect(locationOf(await runProxy("/onboarding"))).toContain("/login");
  });

  it("requires the second factor before onboarding", async () => {
    authState.claims = { sub: "user-1", email: "jan@novafirma.cz", session_id: "s1" };
    authState.user = { id: "user-1", email: "jan@novafirma.cz" };
    expect(locationOf(await runProxy("/onboarding", await signedInCookies("user-1", "s1")))).toContain("/mfa");
  });

  it("lets a verified user open onboarding (the page itself checks the company)", async () => {
    authState.claims = { sub: "user-1", email: "jan@novafirma.cz", session_id: "s1" };
    authState.user = { id: "user-1", email: "jan@novafirma.cz" };
    const response = await runProxy("/onboarding", await verifiedCookies("user-1", "s1"));
    expect(response.status).toBe(200);
  });

  it("keeps an invitation link public", async () => {
    const response = await runProxy("/pozvanka/abc123");
    expect(response.status).toBe(200);
    expect(locationOf(response)).toBe("");
  });

  it("sends a verified user away from registration", async () => {
    authState.claims = { sub: "user-1", email: "jan@novafirma.cz", session_id: "s1" };
    authState.user = { id: "user-1", email: "jan@novafirma.cz" };
    expect(locationOf(await runProxy("/register", await verifiedCookies("user-1", "s1")))).toContain("/dashboard");
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

// splatno.cz/hlavica je vstup R. Hlavica do jejich aplikace. Musí se chovat
// přesně jako /login: veřejný pro nepřihlášené, plně ověřeného uživatele
// pustit rovnou na nástěnku a starou relaci tiše odhlásit, ne poslat jinam.
describe("vstup R. Hlavica /hlavica", () => {
  it("keeps its own registration public", async () => {
    const response = await runProxy("/hlavica/registrace");
    expect(response.status).toBe(200);
    expect(locationOf(response)).toBe("");
  });

  it("is public for an anonymous visitor", async () => {
    const response = await runProxy("/hlavica");
    expect(response.status).toBe(200);
    expect(locationOf(response)).toBe("");
  });

  it("sends a fully verified user straight to the dashboard", async () => {
    authState.claims = { sub: "user-1", email: "test-admin@hlavica.cz", session_id: "s1" };
    authState.user = { id: "user-1", email: "test-admin@hlavica.cz" };
    const response = await runProxy("/hlavica", await signedInCookies("user-1", "s1"));
    expect(locationOf(response)).toContain("/dashboard");
  });

  it("signs out a stale session and keeps showing the login form", async () => {
    authState.claims = { sub: "user-1", email: "ucetni@hlavica.cz", session_id: "s1" };
    authState.user = { id: "user-1", email: "ucetni@hlavica.cz" };
    // Bez podepsané login-session: staré Supabase cookies samy nestačí.
    const response = await runProxy("/hlavica");
    expect(authState.signOutCalls).toBe(1);
    expect(response.status).toBe(200);
    expect(locationOf(response)).toBe("");
  });
});
