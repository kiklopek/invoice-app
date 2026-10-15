import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRequest } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ session: vi.fn(), membership: vi.fn(), rpc: vi.fn(), ares: vi.fn(), limit: vi.fn(), from: vi.fn(), deleteDraft: vi.fn(), draftEq: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedSession: mocks.session, resolveMembership: mocks.membership }));
vi.mock("@/lib/ares", () => ({ lookupAresSubject: mocks.ares }));
vi.mock("@/lib/auth-rate-limit", () => ({ consumePublicAuthLimit: mocks.limit }));
import { POST } from "./route";

const company = {
  name: "Nová firma s.r.o.", ico: "27082440", email: "faktury@novafirma.cz", bank_account_czk: "19-2000145399/0800",
  registered_address: "Dlouhá 1, 110 00 Praha", created_by: "attacker", settings_revision: 99,
};
const call = (body: unknown, origin?: string) => POST(fakeRequest("http://localhost/api/onboarding/organization", {
  method: "POST", body: JSON.stringify(body), origin,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "founder-1" }, email: "jan@novafirma.cz", service: { rpc: mocks.rpc, from: mocks.from } });
  mocks.from.mockReturnValue({ delete: mocks.deleteDraft });
  mocks.deleteDraft.mockReturnValue({ eq: mocks.draftEq });
  mocks.draftEq.mockResolvedValue({ error: null });
  mocks.membership.mockResolvedValue(null);
  mocks.ares.mockResolvedValue({ status: "found", subject: { ico: company.ico, name: company.name } });
  mocks.limit.mockResolvedValue(true);
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
    expect(mocks.from).toHaveBeenCalledWith("onboarding_drafts");
    expect(mocks.draftEq).toHaveBeenCalledWith("user_id", "founder-1");
  });

  it("explains a company that already uses Splatno", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "ico_taken" } });
    const response = await call(company);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("už ve Splatnu je");
  });
});

describe("ověření údajů firmy na serveru", () => {
  it.each([
    ["phone", "123"], ["data_box_id", "abcdef"], ["registered_address", ""],
    ["operating_address", "12345"], ["email", "a@@firma.cz"], ["name", "x".repeat(241)],
  ])("rejects invalid %s before registry or database access", async (field, value) => {
    const response = await call({ ...company, [field]: value });
    expect(response.status).toBe(400);
    expect((await response.json()).fields).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.ares).not.toHaveBeenCalled();
  });
  it("requires DIČ when the user selects VAT payer", async () => {
    const response = await call({ ...company, vat_payer: true, dic: "" });
    expect(response.status).toBe(400);
    expect((await response.json()).fields[0].field).toBe("dic");
  });
  it("rejects a malformed VAT checkbox value", async () => {
    expect((await call({ ...company, vat_payer: "false" })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a checksum-valid IČO that is absent from ARES", async () => {
    mocks.ares.mockResolvedValue({ status: "not_found" });
    const response = await call(company);
    expect(response.status).toBe(400);
    expect((await response.json()).fields[0].field).toBe("ico");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("allows manual entry during a registry outage", async () => {
    mocks.ares.mockResolvedValue({ status: "unavailable", reason: "timeout" });
    expect((await call(company)).status).toBe(201);
  });
  it("normalizes phone, databox and IBAN before storing", async () => {
    expect((await call({ ...company, phone: "00420 777 123 456", data_box_id: "ABC1234", bank_account_eur: "sk31 1200 0000 1987 4263 7541" })).status).toBe(201);
    expect(mocks.rpc.mock.calls[0][1].company).toMatchObject({ phone: "+420777123456", data_box_id: "abc1234", bank_account_eur: "SK3112000000198742637541" });
  });
  it("does not query the registry or create a company after a rate limit or limiter outage", async () => {
    mocks.limit.mockResolvedValue(false);
    expect((await call(company)).status).toBe(429);
    mocks.limit.mockRejectedValue(new Error("Unavailable"));
    expect((await call(company)).status).toBe(503);
    expect(mocks.ares).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
