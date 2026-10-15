import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), signOut: vi.fn(), session: vi.fn(), membership: vi.fn(), mfa: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createUserServerClient: async () => ({ auth: { exchangeCodeForSession: mocks.exchange, signOut: mocks.signOut } }) }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedSession: mocks.session, resolveMembership: mocks.membership }));
vi.mock("@/lib/email-mfa-server", () => ({ hasVerifiedEmailMfa: mocks.mfa }));
vi.mock("@/lib/login-session-server", () => ({ setLoginSessionPreference: mocks.save }));
import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.exchange.mockResolvedValue({ error: null });
  mocks.session.mockResolvedValue({ user: { id: "verified-user" }, email: "founder@example.org", sessionId: "session-1" });
  mocks.membership.mockResolvedValue(null);
  mocks.mfa.mockResolvedValue(false);
});
const callback = (query = "code=verified-code") => GET(new Request(`http://localhost:3000/auth/callback?${query}`));

describe("company founder and invited member after e-mail verification", () => {
  it.each([
    [false, false, "/mfa?returnTo=%2Fonboarding"],
    [false, true, "/onboarding"],
    [true, false, "/mfa?returnTo=%2Fdashboard"],
    [true, true, "/dashboard"],
  ] as const)("company=%s, verified MFA=%s → %s", async (hasCompany, verified, destination) => {
    mocks.membership.mockResolvedValue(hasCompany ? { membership: { organization_id: "inviting-company" } } : null);
    mocks.mfa.mockResolvedValue(verified);
    expect((await callback()).headers.get("location")).toBe(`http://localhost:3000${destination}`);
    expect(mocks.save).toHaveBeenCalledWith(false, { userId: "verified-user", sessionId: "session-1" });
  });

  it("preserves the legacy company entry through MFA", async () => {
    expect((await callback("code=verified-code&vstup=hlavica")).headers.get("location")).toBe("http://localhost:3000/mfa?returnTo=%2Fonboarding&vstup=hlavica");
  });

  it("keeps password recovery separate and refuses arbitrary return URLs", async () => {
    expect((await callback("code=verified-code&next=/reset-password")).headers.get("location")).toBe("http://localhost:3000/reset-password");
    expect(mocks.membership).not.toHaveBeenCalled();
    expect((await callback("code=verified-code&next=https://evil.example")).headers.get("location")).toBe("http://localhost:3000/mfa?returnTo=%2Fonboarding");
  });

  it("never saves a login or enters onboarding after an invalid verification link", async () => {
    mocks.exchange.mockResolvedValue({ error: new Error("expired code") });
    expect((await callback()).headers.get("location")).toBe("http://localhost:3000/login?error=callback");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.membership).not.toHaveBeenCalled();
  });
});
