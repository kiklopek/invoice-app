import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeIdentity, fakeRequest } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), from: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity }));
import { PUT } from "./route";

const company = {
  name: "Nová firma s.r.o.", ico: "27082440", dic: "CZ27082440", registered_address: "Dlouhá 1, Praha",
  operating_address: "", data_box_id: "", phone: "", email: "faktury@novafirma.cz",
  bank_account_czk: "19-2000145399/0800", bank_account_eur: "", revision: 3,
};

function serviceReturning(result: { data: unknown; error: unknown }) {
  const chain = {
    eq: () => chain,
    select: () => chain,
    maybeSingle: () => Promise.resolve(result),
  };
  mocks.update.mockReturnValue(chain);
  mocks.from.mockReturnValue({ update: mocks.update });
  return { from: mocks.from };
}

const save = (body: Record<string, unknown>) => PUT(fakeRequest("http://localhost/api/settings/company", {
  method: "PUT", body: JSON.stringify(body),
}));

beforeEach(() => vi.resetAllMocks());

describe("Nastavení → Firma", () => {
  it("refuses an IČO that belongs to another company with a clear message", async () => {
    mocks.identity.mockResolvedValue(fakeIdentity({
      service: serviceReturning({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "organizations_ico_unique"' } }),
    }));
    const response = await save(company);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("ico_taken");
  });

  it("refuses an IČO whose trial another company already used", async () => {
    mocks.identity.mockResolvedValue(fakeIdentity({
      service: serviceReturning({ data: null, error: { code: "P0001", message: "ico_taken" } }),
    }));
    const response = await save(company);
    expect(response.status).toBe(409);
  });

  // Doménu e-mailů (a tím i vstup R. Hlavica) nastavuje jen migrace/provoz.
  it("never writes allowed_email_domain from the request", async () => {
    mocks.identity.mockResolvedValue(fakeIdentity({
      service: serviceReturning({ data: { ...company, settings_revision: 4 }, error: null }),
    }));
    const response = await save({ ...company, allowed_email_domain: "hlavica.cz" });
    expect(response.status).toBe(200);
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty("allowed_email_domain");
  });
});
