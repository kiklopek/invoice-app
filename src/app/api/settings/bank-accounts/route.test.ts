import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain, fakeIdentity, fakeRequest } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), from: vi.fn(), insert: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity }));
import { DELETE, POST } from "./route";
import { czechAccountToIban } from "@/lib/czech-payment";

const post = (body: unknown) => POST(fakeRequest("http://localhost/api/settings/bank-accounts", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.insert.mockReturnValue(fakeChain({ data: { id: "a1", account: "6844160247/0100", currency: "CZK", label: null }, error: null }));
  mocks.from.mockImplementation((table: string) => table === "organizations"
    ? fakeChain({ data: { bank_account_czk: "6786420257/0100", bank_account_eur: null }, error: null })
    : { insert: mocks.insert });
  mocks.identity.mockResolvedValue(fakeIdentity({ service: { from: mocks.from } }));
});

describe("další bankovní účty firmy", () => {
  it("adds a verified account with its canonical form and currency", async () => {
    const response = await post({ account: "6844160247/0100", currency: "CZK" });
    expect(response.status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: "22222222-2222-4222-8222-222222222222",
      account: "6844160247/0100",
      canonical: czechAccountToIban("6844160247/0100"),
      currency: "CZK",
    }));
  });

  it("accepts a foreign IBAN", async () => {
    expect((await post({ account: "SK31 1200 0000 1987 4263 7541", currency: "EUR" })).status).toBe(201);
  });

  it("refuses an account that fails its check digit, before touching the database", async () => {
    mocks.identity.mockResolvedValue(fakeIdentity());
    expect((await post({ account: "1234567890/0100", currency: "CZK" })).status).toBe(400);
  });

  it("refuses the company's primary account (it is already registered)", async () => {
    expect((await post({ account: "6786420257/0100", currency: "CZK" })).status).toBe(409);
  });

  it("is admin-only", async () => {
    mocks.identity.mockResolvedValue(fakeIdentity({ role: "accounting" }));
    expect((await post({ account: "6844160247/0100", currency: "CZK" })).status).toBe(403);
    const removed = await DELETE(fakeRequest("http://localhost/api/settings/bank-accounts", { method: "DELETE", body: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }) }));
    expect(removed.status).toBe(403);
  });
});
