import { beforeEach, describe, expect, it, vi } from "vitest";
import { SOME_UUID, fakeChain, fakeIdentity, fakeRequest } from "@/app/api/payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ getRequestIdentity: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.getRequestIdentity }));

const { GET } = await import("./route");
const URL_ = `https://app.splatno.cz/api/invoices/${SOME_UUID}/assignable-payments`;
const context = { params: Promise.resolve({ id: SOME_UUID }) };

describe("GET /api/invoices/[id]/assignable-payments", () => {
  beforeEach(() => mocks.getRequestIdentity.mockReset());

  it("odmítne nepřihlášeného uživatele", async () => {
    mocks.getRequestIdentity.mockResolvedValue(null);
    expect((await GET(fakeRequest(URL_), context)).status).toBe(401);
  });

  it("odmítne čtenáře dřív, než se dotkne databáze", async () => {
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "viewer" }));
    expect((await GET(fakeRequest(URL_), context)).status).toBe(403);
  });

  it("vrátí jen přesně odpovídající nespárované platby", async () => {
    const from = vi.fn()
      .mockReturnValueOnce(fakeChain({ data: { amount: 12440, paid_amount: 0, currency: "CZK", status: "pending" }, error: null }))
      .mockReturnValueOnce(fakeChain({ data: [{ id: SOME_UUID, booked_on: "2026-09-25", amount: "12440", currency: "CZK", variable_symbol: "2600199", counterparty_name: "Dřevo Střílky s.r.o.", match_status: "unmatched" }], error: null }));
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "accounting", service: { from } }));

    const response = await GET(fakeRequest(URL_), context);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].amount).toBe(12440);
    expect(from).toHaveBeenNthCalledWith(1, "invoices");
    expect(from).toHaveBeenNthCalledWith(2, "bank_payments");
  });
});
