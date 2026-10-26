import { generateKeyPairSync, sign } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrustedDeviceToken, TRUSTED_DEVICE_COOKIE } from "./email-mfa-core";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined,
  set: (name: string, value: string) => { jar.set(name, value); },
}) }));

// Real proxy, route, cookie signing and installed Supabase SDK. Only the remote
// Auth/PostgREST HTTP service is simulated; no live account is used.
import { proxy } from "@/proxy";
import { POST } from "@/app/api/auth/access/route";

const url = "https://login-fixture.supabase.co";
const secret = "fixture-session-secret".repeat(3);
const sessionId = "33333333-3333-4333-8333-333333333333";
const user = { id: "11111111-1111-4111-8111-111111111111", email: "member@example.com", user_metadata: {} };
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "login-fixture", alg: "RS256", use: "sig" };
let jwt: string;
let revoked: boolean;
let logoutCalls: number;

beforeEach(() => {
  jar.clear();
  revoked = false;
  logoutCalls = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  vi.stubEnv("EMAIL_MFA_SECRET", secret);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: user.id, email: user.email, session_id: sessionId, exp })).toString("base64url");
  const content = `${header}.${payload}`;
  jwt = `${content}.${sign("RSA-SHA256", Buffer.from(content), privateKey).toString("base64url")}`;
  jar.set("sb-login-fixture-auth-token", `base64-${Buffer.from(JSON.stringify({ access_token: jwt, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, expires_at: exp, user })).toString("base64url")}`);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === "/auth/v1/.well-known/jwks.json") return Response.json({ keys: [jwk] });
    if (path === "/auth/v1/logout") {
      logoutCalls++;
      revoked = true;
      return new Response(null, { status: 204 });
    }
    if (path === "/auth/v1/user") return revoked
      ? Response.json({ code: "session_not_found", msg: "Session not found" }, { status: 403 })
      : Response.json(user);
    if (path === "/rest/v1/organization_members") return Response.json([]);
    throw new Error(`Unexpected fixture request: ${path}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function pageRequest(path: string, background: boolean) {
  const req = new NextRequest(`https://app.example${path}`, { headers: { "sec-fetch-dest": background ? "empty" : "document" } });
  for (const [name, value] of jar) req.cookies.set(name, value);
  return req;
}
const bootstrap = () => POST(new Request("https://app.example/api/auth/access", {
  method: "POST", headers: { origin: "https://app.example", Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
  body: JSON.stringify({ remember: true }),
}));

describe("login bootstrap with real Supabase SDK and proxy", () => {
  it("finishes bootstrap despite a login-page refresh after the JWT is issued", async () => {
    expect((await proxy(pageRequest("/login", true))).status).toBe(200);
    expect(logoutCalls).toBe(0);
    const response = await bootstrap();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ needsOnboarding: true, mfa_bypassed: false });
    expect(jar.has("splatno-login-session")).toBe(true);
    expect((await proxy(pageRequest("/mfa", false))).status).toBe(200);
  });

  it("restores trusted-device MFA and allows onboarding after the background refresh", async () => {
    jar.set(TRUSTED_DEVICE_COOKIE, createTrustedDeviceToken({ userId: user.id, secret }));
    await proxy(pageRequest("/register", true));
    const response = await bootstrap();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mfa_bypassed: true });
    expect((await proxy(pageRequest("/onboarding", false))).status).toBe(200);
    expect(logoutCalls).toBe(0);
  });

  it("rejects a genuinely revoked session rather than trusting its signed JWT", async () => {
    // A real document visit intentionally abandons the unfinished login.
    await proxy(pageRequest("/login", false));
    expect(logoutCalls).toBe(1);
    expect((await bootstrap()).status).toBe(401);
    expect(jar.has("splatno-login-session")).toBe(false);
  });
});
