import { beforeEach, describe, expect, it, vi } from "vitest";

// getRequestIdentity() běží před každou stránkou i API routou. getUser() je
// síťové kolo na Supabase Auth (~70 ms) a je to JEDINÉ místo, které pozná
// token odvolaný na serveru (odhlášení, zablokovaný účet) -- kontrola
// přihlašovací session je jen podepsaná cookie. Proto se nesmí vynechat,
// jen spustit souběžně s ostatními čteními.
//
// Tyhle testy drží obě strany: rychlost (čtení nečekají na getUser) i
// bezpečnost (bez úspěšného getUser není identita a hlavně se nic nezapíše).

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const membershipRow = { id: "m1", organization_id: "org1", role: "admin", email: "anna@hlavica.cz" };

const state = vi.hoisted(() => ({
  events: [] as string[],
  claims: {} as Record<string, unknown>,
  getUser: null as null | (() => Promise<{ data: { user: unknown }; error: unknown }>),
  membershipEmails: [] as string[],
  membership: null as unknown,
  invitation: null as unknown,
  updates: 0,
}));

function membershipQuery(table: string) {
  const filters: Record<string, unknown> = {};
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => { filters[column] = value; return builder; },
    is: (column: string, value: unknown) => { filters[column] = value; return builder; },
    order: () => builder,
    limit: () => builder,
    update: () => { state.updates += 1; state.events.push("zapis-pozvanky"); return builder; },
    maybeSingle: async () => {
      if (table !== "organization_members") return { data: null, error: null };
      if (filters.user_id === null) return { data: state.invitation, error: null };
      if ("user_id" in filters) {
        state.events.push("cteni-clenstvi");
        state.membershipEmails.push(String(filters.email));
        return { data: state.membership, error: null };
      }
      return { data: state.invitation, error: null };
    },
  };
  return builder;
}

const client = {
  auth: {
    getClaims: async () => ({ data: { claims: state.claims }, error: null }),
    getUser: () => {
      state.events.push("getUser-start");
      return state.getUser!().then((result) => { state.events.push("getUser-konec"); return result; });
    },
  },
  from: (table: string) => membershipQuery(table),
};

vi.mock("@/lib/supabase-server", () => ({
  createUserServerClient: async () => client,
  createServiceClient: () => client,
}));
vi.mock("@/lib/login-session-server", () => ({
  hasServerLoginSession: async () => { state.events.push("cteni-session"); return true; },
}));
vi.mock("@/lib/email-mfa-server", () => ({
  hasVerifiedEmailMfa: async () => { state.events.push("cteni-mfa"); return true; },
}));

const { getRequestIdentity } = await import("@/lib/auth");

function user(email: string) {
  return { data: { user: { id: USER_ID, email, user_metadata: {} } }, error: null };
}

beforeEach(() => {
  state.events = [];
  state.membershipEmails = [];
  state.updates = 0;
  state.claims = { sub: USER_ID, session_id: SESSION_ID, email: "anna@hlavica.cz" };
  state.membership = membershipRow;
  state.invitation = null;
  state.getUser = async () => user("anna@hlavica.cz");
});

describe("getRequestIdentity", () => {
  it("spustí čtení session, MFA a členství, aniž by čekala na getUser", async () => {
    const pending = deferred<ReturnType<typeof user>>();
    state.getUser = () => pending.promise;

    const result = getRequestIdentity();
    // Nechat proběhnout všechny mikroúlohy; getUser přitom pořád visí.
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(state.events).toContain("getUser-start");
    expect(state.events).toContain("cteni-clenstvi");
    expect(state.events).toContain("cteni-session");
    expect(state.events).toContain("cteni-mfa");
    expect(state.events).not.toContain("getUser-konec");

    pending.resolve(user("anna@hlavica.cz"));
    const identity = await result;
    expect(identity?.user).toMatchObject({ id: USER_ID });
    expect(identity?.membership).toMatchObject({ organization_id: "org1", role: "admin" });
  });

  it("odvolaný token (getUser selže) nevrátí identitu", async () => {
    state.getUser = async () => ({ data: { user: null }, error: new Error("session revoked") });
    await expect(getRequestIdentity()).resolves.toBeNull();
  });

  it("nevrátí identitu, když se getUser a token neshodnou na uživateli", async () => {
    state.getUser = async () => ({ data: { user: { id: "jiny-uzivatel", email: "anna@hlavica.cz", user_metadata: {} } }, error: null });
    await expect(getRequestIdentity()).resolves.toBeNull();
  });

  it("pozvánku převezme až PO ověření přes getUser, nikdy předtím", async () => {
    state.membership = null;
    state.invitation = { id: "inv1", organization_id: "org1", role: "member", email: "anna@hlavica.cz" };
    const pending = deferred<ReturnType<typeof user>>();
    state.getUser = () => pending.promise;

    const result = getRequestIdentity();
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(state.updates).toBe(0);

    pending.resolve(user("anna@hlavica.cz"));
    await result;
    expect(state.events.indexOf("zapis-pozvanky")).toBeGreaterThan(state.events.indexOf("getUser-konec"));
  });

  it("odvolaný token nepřevezme pozvánku", async () => {
    state.membership = null;
    state.invitation = { id: "inv1", organization_id: "org1", role: "member", email: "anna@hlavica.cz" };
    state.getUser = async () => ({ data: { user: null }, error: new Error("session revoked") });
    await expect(getRequestIdentity()).resolves.toBeNull();
    expect(state.updates).toBe(0);
  });

  it("když se e-mail v tokenu liší od e-mailu na serveru, rozhoduje server", async () => {
    // Uživatel si změnil e-mail; token ještě nese starý až do obnovení.
    state.claims = { ...state.claims, email: "stary@hlavica.cz" };
    state.getUser = async () => user("anna@hlavica.cz");
    const identity = await getRequestIdentity();
    expect(state.membershipEmails.at(-1)).toBe("anna@hlavica.cz");
    expect(identity?.membership.email).toBe("anna@hlavica.cz");
  });

  it("nefiremní e-mail na serveru neprojde, ani když token nese firemní", async () => {
    // Firemní doména se vynucuje jen v produkčním režimu (auth-policy.ts).
    vi.stubEnv("NODE_ENV", "production");
    state.getUser = async () => user("anna@gmail.com");
    await expect(getRequestIdentity()).resolves.toBeNull();
    vi.unstubAllEnvs();
  });
});
