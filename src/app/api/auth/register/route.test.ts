import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRequest } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ limit: vi.fn(), access: vi.fn(), generate: vi.fn(), send: vi.fn(), verify: vi.fn(), update: vi.fn(), signOut: vi.fn(), session: vi.fn(), membership: vi.fn(), login: vi.fn(), mfa: vi.fn(), trust: vi.fn(), allow: vi.fn(), prepare: vi.fn(), saveChallenge: vi.fn(), discard: vi.fn(), finish: vi.fn(), cooldown: vi.fn() }));
vi.mock("@/lib/local-email-allowlist", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/local-email-allowlist")>(),
  assertLocalEmailRecipientsAllowed: mocks.allow,
}));
vi.mock("@/lib/registration-code-server", () => ({ prepareRegistrationCode: mocks.prepare, saveRegistrationChallenge: mocks.saveChallenge, discardRegistrationChallenge: mocks.discard, finishRegistrationCode: mocks.finish, registrationCodeRetryAfter: mocks.cooldown }));
vi.mock("@/lib/auth-rate-limit", () => ({ consumePublicAuthLimit: mocks.limit }));
vi.mock("@/lib/registration-access-server", () => ({ getRegistrationAccess: mocks.access }));
vi.mock("@/lib/registration-email-server", () => ({ sendRegistrationCode: mocks.send }));
vi.mock("@/lib/email-mfa-server", () => ({ getEmailMfaConfiguration: () => ({}), requireEmailMfaSecret: () => "secret", setVerifiedEmailMfaCookie: mocks.mfa, setTrustedDeviceCookie: mocks.trust }));
vi.mock("@/lib/login-session-server", () => ({ setLoginSessionPreference: mocks.login }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedSession: mocks.session, resolveMembership: mocks.membership }));
vi.mock("@/lib/supabase-server", () => ({
  createServiceClient: () => ({ auth: { admin: { generateLink: mocks.generate } } }),
  createUserServerClient: async () => ({ auth: { verifyOtp: mocks.verify, updateUser: mocks.update, signOut: mocks.signOut } }),
}));
import { POST } from "./route";
import { LocalEmailRecipientBlockedError } from "@/lib/local-email-allowlist";
const email = "jana@example.org";
const user = { id: "user-a", email, email_confirmed_at: "2026-10-15" };
const input = { action: "send", email, password: "Bezpecne-Heslo-2026", fullName: "Jana Nováková", acceptTerms: true, entry: "splatno" };
const call = (overrides = {}, origin?: string) => POST(fakeRequest("http://localhost/api/auth/register", { method: "POST", origin, body: JSON.stringify({ ...input, ...overrides }) }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockResolvedValue(true);
  mocks.access.mockResolvedValue({ allowed: true, kind: "signup" });
  mocks.generate.mockResolvedValue({ data: { user: { id: user.id }, properties: { hashed_token: "native-hash", action_link: "private-link" } }, error: null });
  mocks.send.mockResolvedValue(undefined);
  mocks.prepare.mockResolvedValue({ challenge: { userId: user.id }, code: "A7K9B" });
  mocks.finish.mockResolvedValue({ userId: user.id, nativeTokenHash: "native-hash" });
  mocks.cooldown.mockResolvedValue(0);
  mocks.verify.mockResolvedValue({ data: { user, session: { access_token: "private-token" } }, error: null });
  mocks.update.mockResolvedValue({ error: null });
  mocks.session.mockResolvedValue({ user, email, sessionId: "session-a" });
  mocks.membership.mockResolvedValue(null);
});

describe("registration with one email code", () => {
  it("sends only the generated code and never returns it or an authentication link", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true });
    expect(mocks.send).toHaveBeenCalledWith({ email, code: "A7K9B", locale: "cs" });
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.mfa).not.toHaveBeenCalled();
  });
  it("confirms email and first sign-in together and directs a founder to onboarding", async () => {
    const response = await call({ action: "verify", code: "A7K9B" });
    expect(await response.json()).toEqual({ verified: true, redirect: "/onboarding" });
    expect(mocks.verify).toHaveBeenCalledWith({ token_hash: "native-hash", type: "signup" });
    expect(mocks.login).toHaveBeenCalledWith(false, { userId: user.id, sessionId: "session-a" });
    expect(mocks.mfa).toHaveBeenCalledWith(user.id, "session-a");
    expect(mocks.update).toHaveBeenCalledWith({ password: input.password, data: { full_name: input.fullName, terms_accepted_at: expect.any(String) } });
  });
  it("directs a verified invited user to their company instead of creating another company", async () => {
    mocks.membership.mockResolvedValue({ membership: { role: "accounting" } });
    expect(await (await call({ action: "verify", code: "A7K9B" })).json()).toMatchObject({ redirect: "/dashboard" });
  });
  it("retains the chosen password when Auth reports it is already set and still saves verified profile data", async () => {
    mocks.update.mockResolvedValueOnce({ error: { code: "same_password" } }).mockResolvedValueOnce({ error: null });
    expect((await call({ action: "verify", code: "A7K9B" })).status).toBe(200);
    expect(mocks.update.mock.calls[1][0]).toEqual({ data: { full_name: input.fullName, terms_accepted_at: expect.any(String) } });
    expect(mocks.mfa).toHaveBeenCalledOnce();
  });
  it.each(["invalid", "expired", "replayed"])("does not create MFA or change a password for a %s code", async () => {
    mocks.finish.mockResolvedValue(null);
    expect((await call({ action: "verify", code: "A7K9B" })).status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.mfa).not.toHaveBeenCalled();
  });
  it("does not reset a confirmed existing account or reveal its existence", async () => {
    mocks.generate.mockResolvedValue({ data: {}, error: { code: "email_exists" } });
    expect(await (await call()).json()).toEqual({ sent: true });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("fails closed if the account's email was not confirmed", async () => {
    mocks.verify.mockResolvedValue({ data: { user: { ...user, email_confirmed_at: null }, session: {} }, error: null });
    expect((await call({ action: "verify", code: "A7K9B" })).status).toBe(400);
    expect(mocks.mfa).not.toHaveBeenCalled();
  });
  it("handles delivery failure without reporting success or leaking the provider payload", async () => {
    mocks.send.mockRejectedValue(new Error("secret-code-and-provider-payload"));
    const response = await call();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("email_delivery_failed");
    expect(JSON.stringify(body)).not.toContain("secret-code");
  });
  it("rejects a locally blocked address before creating any account or OTP", async () => {
    mocks.allow.mockImplementation(() => { throw new LocalEmailRecipientBlockedError(); });
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "local_email_blocked" });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("signs out if the first verified session cannot be stored", async () => {
    mocks.login.mockRejectedValue(new Error("cookie failed"));
    expect((await call({ action: "verify", code: "A7K9B" })).status).toBe(503);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.membership).not.toHaveBeenCalled();
  });
  it("requires both same-origin and server-side registration eligibility", async () => {
    expect((await call({}, "https://evil.invalid")).status).toBe(403);
    expect(mocks.generate).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue({ allowed: false, kind: "not_invited" });
    expect((await call()).status).toBe(403);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("rate limits sending and verification separately before contacting auth", async () => {
    mocks.limit.mockResolvedValue(false);
    expect((await call()).status).toBe(429);
    expect((await call({ action: "verify", code: "A7K9B" })).status).toBe(429);
    expect(mocks.limit.mock.calls.map(call => call[1])).toEqual(["registration_send", "registration_verify"]);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
