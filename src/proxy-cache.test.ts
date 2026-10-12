import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createEmailMfaToken, EMAIL_MFA_COOKIE } from "@/lib/email-mfa-core";
import { createLoginSessionToken, LOGIN_SESSION_COOKIE } from "@/lib/login-session";

const mocks = vi.hoisted(() => ({ claims: vi.fn(), signOut: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (cookies: unknown[], headers: Record<string, string>) => void } }) => {
    options.cookies.setAll([{ name: "sb-refreshed", value: "fixture", options: { httpOnly: true, secure: true } }], { "cache-control": "private, no-store", expires: "0", pragma: "no-cache" });
    return { auth: { getClaims: mocks.claims, signOut: mocks.signOut } };
  },
}));
import { proxy } from "./proxy";

const secret = "a-strong-fixture-secret-longer-than-thirty-two-characters";
const userId = "fixture-user";
const sessionId = "fixture-session";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-public-key");
  vi.stubEnv("EMAIL_MFA_SECRET", secret);
  mocks.claims.mockResolvedValue({ data: { claims: { sub: userId, session_id: sessionId, email: "fixture@example.invalid" } }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("proxy refresh and redirect security", () => {
  it("preserves refreshed cookies and cache headers when redirecting", async () => {
    const login = createLoginSessionToken({ userId, sessionId, remember: false, secret });
    const mfa = createEmailMfaToken({ userId, sessionId, secret });
    const response = await proxy(new NextRequest("https://example.invalid/login", { headers: { cookie: `${LOGIN_SESSION_COOKIE}=${login}; ${EMAIL_MFA_COOKIE}=${mfa}` } }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.invalid/dashboard");
    expect(response.cookies.get("sb-refreshed")?.value).toBe("fixture");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("server-timing")).toMatch(/^proxy;dur=[\d.]+$/);
  });

  it("does not accept claims rejected by the SDK", async () => {
    mocks.claims.mockResolvedValue({ data: null, error: new Error("invalid signature") });
    const response = await proxy(new NextRequest("https://example.invalid/settings"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("continues to revoke stale browser sessions", async () => {
    const response = await proxy(new NextRequest("https://example.invalid/settings"));
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.cookies.get(LOGIN_SESSION_COOKIE)?.value).toBe("");
    expect(response.cookies.get(EMAIL_MFA_COOKIE)?.value).toBe("");
  });
});
