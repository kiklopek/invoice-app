import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain, fakeIdentity, fakeRequest, SOME_UUID } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ getRequestIdentity: vi.fn() }));
vi.mock("@/lib/auth", async () => ({
  getRequestIdentity: mocks.getRequestIdentity,
  canManageInvoices: (await import("@/lib/role-access")).canManageInvoices,
}));
const { PATCH } = await import("./route");
const invoice = {
  id: SOME_UUID, invoice_number: "9001", counterparty_name: "Test",
  counterparty_email: "test@example.cz", amount: 100, amount_without_vat: 100,
  vat_rate: 0, currency: "CZK", issue_date: "2026-09-01", due_date: "2026-09-30",
  status: "paid", paid_amount: 100, money_evidence: null,
};
const patch = (body: unknown) => PATCH(fakeRequest(`https://app.splatno.cz/api/invoices/${SOME_UUID}`, {
  method: "PATCH", body: JSON.stringify(body),
}), { params: Promise.resolve({ id: SOME_UUID }) });

describe("invoice edit monetary guards", () => {
  beforeEach(() => {
    mocks.getRequestIdentity.mockReset();
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ service: {
      from: () => fakeChain({ data: invoice, error: null }),
    } }));
  });
  it("cannot invent another payment when increasing an already paid total", async () => {
    const response = await patch({ amount: 200, amount_without_vat: 200 });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Úprava faktury nesmí vytvářet platby");
  });
  it("cannot create an initial payment via invoice edit", async () => {
    const response = await patch({ money_evidence: {
      original_total:100,total_source:"manual",adjustment:0,adjustment_reason:"",
      adjustment_confirmed:false,initial_paid:50,initial_paid_confirmed:true,multi_rate:false,
    } });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Počáteční úhradu");
  });
  it("rejects malformed monetary inputs without a server exception", async () => {
    expect((await patch({ amount: "not a number" })).status).toBe(400);
  });
});
