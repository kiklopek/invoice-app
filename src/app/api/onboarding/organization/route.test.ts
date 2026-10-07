import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRequest } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ session: vi.fn(), membership: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedSession: mocks.session, resolveMembership: mocks.membership }));
import { POST } from "./route";

const company = {
  name: "Nová firma s.r.o.", ico: "27082440", email: "faktury@novafirma.cz", bank_account_czk: "19-2000145399/0800",
  created_by: "attacker", settings_revision: 99,
};
const call = (body: unknown, origin?: string) => POST(fakeRequest("http://localhost/api/onboarding/organization", {
  method: "POST", body: JSON.stringify(body), origin,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "founder-1" }, email: "jan@novafirma.cz", service: { rpc: mocks.rpc } });
  mocks.membership.mockResolvedValue(null);
  mocks.rpc.mockResolvedValue({ data: { organization_id: "org-1" }, error: null });
});

describe("založení firmy z onboardingu", () => {
  it("requires same origin and a verified session (2FA)", async () => {
    expect((await call(company, "https://evil.example")).status).toBe(403);
    mocks.session.mockResolvedValue(null);
    expect((await call(company)).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("never creates a second company for someone who already belongs to one", async () => {
    mocks.membership.mockResolvedValue({ membership: { organization_id: "org-0" } });
    const response = await call(company);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("already_member");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid company before touching the database", async () => {
    const response = await call({ ...company, ico: "12345678", bank_account_czk: "" });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.fields.map((field: { field: string }) => field.field).sort()).toEqual(["bank_account_czk", "ico"]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("creates the company in one call with only whitelisted fields, for the signed-in founder", async () => {
    const response = await call(company);
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("create_organization_for_user");
    expect(args.founder_user).toBe("founder-1");
    expect(args.company).not.toHaveProperty("created_by");
    expect(args.company).not.toHaveProperty("settings_revision");
    expect(args.company.ico).toBe("27082440");
  });

  it("explains a company that already uses Splatno", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "ico_taken" } });
    const response = await call(company);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("už ve Splatnu je");
  });
});
