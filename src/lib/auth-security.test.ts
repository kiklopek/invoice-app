import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain } from "@/app/api/payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ claims: vi.fn(), user: vi.fn(), userFrom: vi.fn(), serviceFrom: vi.fn(), rpc: vi.fn(), login: vi.fn(), mfa: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  createUserServerClient: async () => ({ auth: { getClaims: mocks.claims, getUser: mocks.user }, from: mocks.userFrom }),
  createServiceClient: () => ({ from: mocks.serviceFrom, rpc: mocks.rpc }),
}));
vi.mock("@/lib/login-session-server", () => ({ hasServerLoginSession: mocks.login }));
vi.mock("@/lib/email-mfa-server", () => ({ hasVerifiedEmailMfa: mocks.mfa }));
import { getAuthenticatedSession, getRequestIdentity } from "./auth";

const user = { id: "user-a", email: "member@example.invalid", email_confirmed_at: "2026-01-01", user_metadata: { role: "admin" } };
const member = { id: "member-a", organization_id: "org-a", role: "accounting", email: user.email, support_expires_at: null, support_reason: null };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.claims.mockResolvedValue({ data: { claims: { sub: user.id, session_id: "session-a" } }, error: null });
  mocks.user.mockResolvedValue({ data: { user }, error: null });
  mocks.login.mockResolvedValue(true);
  mocks.mfa.mockResolvedValue(true);
  mocks.userFrom.mockReturnValue(fakeChain({ data: member, error: null }));
  mocks.serviceFrom.mockReturnValue(fakeChain({ data: null, error: null }));
});

describe("verified identity and isolation", () => {
  it("allows a verified founder's session while denying access to company data before onboarding", async () => {
    mocks.userFrom.mockReturnValue(fakeChain({ data: null, error: null }));
    const session = await getAuthenticatedSession();
    expect(session).toMatchObject({ user: { id: user.id }, sessionId: "session-a", boundMembership: null });
    expect(await getRequestIdentity()).toBeNull();
  });

  it("rejects unverified claims without calling the user or membership endpoints", async () => {
    mocks.claims.mockResolvedValue({ data: null, error: new Error("invalid signature") });
    expect(await getRequestIdentity()).toBeNull();
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.userFrom).not.toHaveBeenCalled();
  });

  it("retains the current Auth-server check and rejects a mismatched subject", async () => {
    mocks.user.mockResolvedValue({ data: { user: { ...user, id: "other-user" } }, error: null });
    expect(await getRequestIdentity()).toBeNull();
    expect(mocks.user).toHaveBeenCalledOnce();
    expect(mocks.userFrom).not.toHaveBeenCalled();
  });

  it("rejects a user no longer accepted by the Auth server", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: new Error("revoked") });
    expect(await getAuthenticatedSession()).toBeNull();
    expect(mocks.userFrom).not.toHaveBeenCalled();
  });

  it.each(["login", "mfa"] as const)("requires %s before claiming an invitation", async (gate) => {
    mocks.userFrom.mockReturnValue(fakeChain({ data: null, error: null }));
    mocks[gate].mockResolvedValue(false);
    expect(await getRequestIdentity()).toBeNull();
    expect(mocks.serviceFrom).not.toHaveBeenCalled();
  });

  it("takes the role from membership rather than user-editable metadata", async () => {
    const identity = await getRequestIdentity();
    expect(identity?.membership.role).toBe("accounting");
    expect(identity?.membership.organization_id).toBe("org-a");
    expect(mocks.userFrom).toHaveBeenCalledWith("organization_members");
  });

  it("does not reuse a previous Route Handler user's identity", async () => {
    expect((await getRequestIdentity())?.user.id).toBe("user-a");
    const nextUser = { ...user, id: "user-b", email: "other@example.invalid" };
    mocks.claims.mockResolvedValue({ data: { claims: { sub: nextUser.id, session_id: "session-b" } }, error: null });
    mocks.user.mockResolvedValue({ data: { user: nextUser }, error: null });
    mocks.userFrom.mockReturnValue(fakeChain({ data: { ...member, id: "member-b", organization_id: "org-b", email: nextUser.email }, error: null }));
    const identity = await getRequestIdentity();
    expect(identity?.user.id).toBe("user-b");
    expect(identity?.membership.organization_id).toBe("org-b");
    expect(mocks.claims).toHaveBeenCalledTimes(2);
    expect(mocks.user).toHaveBeenCalledTimes(2);
  });
});
