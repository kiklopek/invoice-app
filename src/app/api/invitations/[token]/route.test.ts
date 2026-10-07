import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRequest } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(), load: vi.fn(), createUser: vi.fn(), deleteUser: vi.fn(), rpc: vi.fn(),
  signIn: vi.fn(), signOut: vi.fn(), loginPref: vi.fn(), mfaCookie: vi.fn(),
}));
vi.mock("@/lib/auth-rate-limit", () => ({ consumePublicAuthLimit: mocks.limit }));
vi.mock("@/lib/invitation-server", () => ({ loadInvitation: mocks.load }));
vi.mock("@/lib/login-session-server", () => ({ setLoginSessionPreference: mocks.loginPref }));
vi.mock("@/lib/email-mfa-server", () => ({ setVerifiedEmailMfaCookie: mocks.mfaCookie }));
vi.mock("@/lib/supabase-server", () => ({
  createServiceClient: () => ({ auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } }, rpc: mocks.rpc }),
  createUserServerClient: async () => ({ auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut } }),
}));
import { POST } from "./route";

const TOKEN = "A".repeat(43);
const SESSION_TOKEN = `x.${Buffer.from(JSON.stringify({ session_id: "11111111-1111-4111-8111-111111111111" })).toString("base64url")}.y`;
const body = { fullName: "Jana Nováková", password: "Silne-Heslo-2026", acceptTerms: true };
const call = (payload: unknown = body, token = TOKEN, origin?: string) => POST(
  fakeRequest(`http://localhost/api/invitations/${token}`, { method: "POST", body: JSON.stringify(payload), origin }),
  { params: Promise.resolve({ token }) },
);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockResolvedValue(true);
  mocks.load.mockResolvedValue({ status: "valid", memberId: "m1", email: "jana@novafirma.cz", role: "accounting", companyName: "Nová firma", companyLogo: null, expiresAt: "2099-01-01T00:00:00Z", tokenHash: "f".repeat(64) });
  mocks.createUser.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
  mocks.signIn.mockResolvedValue({ data: { user: { id: "new-user" }, session: { access_token: SESSION_TOKEN } }, error: null });
  mocks.rpc.mockResolvedValue({ data: { organization_id: "org-1" }, error: null });
});

describe("přijetí pozvánky", () => {
  it("refuses foreign origins and malformed tokens without touching anything", async () => {
    expect((await call(body, TOKEN, "https://evil.example")).status).toBe(403);
    expect((await call(body, "short")).status).toBe(404);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("validates name, password strength and consent before creating an account", async () => {
    expect((await call({ ...body, acceptTerms: false })).status).toBe(400);
    expect((await call({ ...body, fullName: "J" })).status).toBe(400);
    expect((await call({ ...body, password: "slabe" })).status).toBe(400);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("does not accept an expired or unknown invitation", async () => {
    mocks.load.mockResolvedValue({ status: "expired" });
    expect((await call()).status).toBe(410);
    mocks.load.mockResolvedValue({ status: "invalid" });
    expect((await call()).status).toBe(404);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("is rate limited per token", async () => {
    mocks.limit.mockResolvedValue(false);
    expect((await call()).status).toBe(429);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("creates the account for the invited e-mail only, joins the company and counts the link as 2FA", async () => {
    const response = await call({ ...body, email: "someone-else@evil.example" });
    expect(response.status).toBe(200);
    expect((await response.json()).redirect).toBe("/dashboard");
    expect(mocks.createUser.mock.calls[0][0]).toMatchObject({ email: "jana@novafirma.cz", email_confirm: true });
    expect(mocks.rpc).toHaveBeenCalledWith("accept_organization_invitation", { token_hash: "f".repeat(64), accepting_user: "new-user" });
    expect(mocks.mfaCookie).toHaveBeenCalledWith("new-user", "11111111-1111-4111-8111-111111111111");
  });

  it("asks an existing account for its own password instead of overwriting it", async () => {
    mocks.createUser.mockResolvedValue({ data: { user: null }, error: { code: "email_exists" } });
    mocks.signIn.mockResolvedValue({ data: { user: null, session: null }, error: { message: "Invalid login credentials" } });
    const response = await call();
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("existing_account_password");
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rolls back a freshly created account when the database refuses the invitation", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "member_of_other_organization" } });
    const response = await call();
    expect(response.status).toBe(409);
    expect(mocks.deleteUser).toHaveBeenCalledWith("new-user", false);
    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.mfaCookie).not.toHaveBeenCalled();
  });
});
