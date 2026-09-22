import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Rate limit chrání dvě veřejné routy, na které se dá útočit bez přihlášení:
// zjišťování, jestli e-mail má přístup, a obnovu hesla. Modul neměl jediný
// test, přestože rozhoduje o tom, jestli jde účty enumerovat.

const rpcCalls: Array<Record<string, unknown>> = [];
let rpcResult: { data: unknown; error: unknown } = { data: true, error: null };

vi.mock("@/lib/supabase-server", () => ({
  createServiceClient: () => ({
    rpc: async (_name: string, params: Record<string, unknown>) => {
      rpcCalls.push(params);
      return rpcResult;
    },
  }),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResult = { data: true, error: null };
  process.env.EMAIL_MFA_SECRET = "test-secret-with-at-least-32-characters!!";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

const load = () => import("./auth-rate-limit");

describe("authRateLimitSubject", () => {
  it("never stores the raw e-mail or IP, only a hash", async () => {
    const { authRateLimitSubject } = await load();
    const hash = authRateLimitSubject("email:ucetni@hlavica.cz");
    expect(hash).not.toContain("ucetni");
    expect(hash).not.toContain("@");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same input and different for another", async () => {
    const { authRateLimitSubject } = await load();
    expect(authRateLimitSubject("ip:1.2.3.4")).toBe(authRateLimitSubject("ip:1.2.3.4"));
    expect(authRateLimitSubject("ip:1.2.3.4")).not.toBe(authRateLimitSubject("ip:1.2.3.5"));
  });

  it("separates namespaces, so an IP cannot collide with an e-mail", async () => {
    const { authRateLimitSubject } = await load();
    expect(authRateLimitSubject("ip:x")).not.toBe(authRateLimitSubject("email:x"));
  });

  it("refuses to run without a strong secret instead of hashing with a weak one", async () => {
    process.env.EMAIL_MFA_SECRET = "";
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
    const { authRateLimitSubject } = await load();
    expect(() => authRateLimitSubject("ip:1.2.3.4")).toThrow();
    Object.defineProperty(process.env, "NODE_ENV", { value: "test", configurable: true });
  });
});

describe("requestIp", () => {
  it("reads the first address of the forwarding chain", async () => {
    const { requestIp } = await load();
    const request = new Request("https://app.example", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" },
    });
    expect(requestIp(request)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip and then to a placeholder", async () => {
    const { requestIp } = await load();
    expect(requestIp(new Request("https://app.example", { headers: { "x-real-ip": "198.51.100.7" } }))).toBe("198.51.100.7");
    // Neznámý zdroj nesmí projít jako "bez limitu" -- dostane vlastní kbelík.
    expect(requestIp(new Request("https://app.example"))).toBe("unknown");
  });
});

describe("consumePublicAuthLimit", () => {
  it("checks the IP and the e-mail separately", async () => {
    const { consumePublicAuthLimit } = await load();
    const request = new Request("https://app.example", { headers: { "x-forwarded-for": "203.0.113.5" } });
    await consumePublicAuthLimit(request, "password_recovery", "ucetni@hlavica.cz");
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0].target_action).toBe("password_recovery_ip");
    expect(rpcCalls[1].target_action).toBe("password_recovery_email");
  });

  it("uses the stricter limit for password recovery than for access checks", async () => {
    const { consumePublicAuthLimit } = await load();
    const request = new Request("https://app.example");
    await consumePublicAuthLimit(request, "password_recovery", "a@hlavica.cz");
    const recovery = { ip: rpcCalls[0].target_max_attempts, email: rpcCalls[1].target_max_attempts };
    rpcCalls.length = 0;
    await consumePublicAuthLimit(request, "registration_access", "a@hlavica.cz");
    const access = { ip: rpcCalls[0].target_max_attempts, email: rpcCalls[1].target_max_attempts };
    // Obnova hesla reálně odesílá e-mail, takže musí být přísnější.
    expect(Number(recovery.ip)).toBeLessThan(Number(access.ip));
    expect(Number(recovery.email)).toBeLessThan(Number(access.email));
  });

  it("stops at the first exhausted bucket without consuming the second", async () => {
    rpcResult = { data: false, error: null };
    const { consumePublicAuthLimit } = await load();
    const allowed = await consumePublicAuthLimit(new Request("https://app.example"), "password_recovery", "a@hlavica.cz");
    expect(allowed).toBe(false);
    expect(rpcCalls).toHaveLength(1);
  });

  it("fails loudly when the database rejects the call, instead of letting it through", async () => {
    // Tiché povolení při chybě by z rate limitu udělalo dekoraci.
    rpcResult = { data: null, error: new Error("rpc down") };
    const { consumePublicAuthLimit } = await load();
    await expect(
      consumePublicAuthLimit(new Request("https://app.example"), "registration_access", "a@hlavica.cz"),
    ).rejects.toThrow();
  });
});
