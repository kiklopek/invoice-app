import { beforeEach, describe, expect, it, vi } from "vitest";
import { SOME_UUID, fakeChain, fakeIdentity, fakeRequest } from "@/app/api/payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ getRequestIdentity: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.getRequestIdentity }));

const { GET } = await import("./route");
const URL_ = `https://app.splatno.cz/api/invoices/${SOME_UUID}/assignable-payments`;
const context = { params: Promise.resolve({ id: SOME_UUID }) };
const invoice = { amount: 12440, paid_amount: 0, currency: "CZK", status: "pending" };
const payment = (id: string, amount = "12440", currency = "CZK") => ({
  id, booked_on: "2026-09-25", amount, currency, variable_symbol: "2600199",
  counterparty_name: "Dřevo Střílky s.r.o.", match_status: "unmatched",
});

function paymentsChain(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(), eq: vi.fn(), in: vi.fn(), is: vi.fn(), order: vi.fn(), range: vi.fn(),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of [query.select, query.eq, query.in, query.is, query.order, query.range]) method.mockReturnValue(query);
  return query;
}

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

  it("vrátí všechny nepřiřazené platby a přesné shody doporučí jako první", async () => {
    const query = paymentsChain({ data: [
      payment("partial", "5000"), payment("other-currency", "12440", "EUR"),
      payment("too-large", "13000"), payment(SOME_UUID),
    ], error: null });
    const from = vi.fn()
      .mockReturnValueOnce(fakeChain({ data: invoice, error: null }))
      .mockReturnValueOnce(query);
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "accounting", service: { from } }));

    const response = await GET(fakeRequest(URL_), context);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.payments.map((row: { id: string }) => row.id)).toEqual([SOME_UUID, "partial", "other-currency", "too-large"]);
    expect(body.payments[0].amount).toBe(12440);
    expect(body.payments[0].recommended).toBe(true);
    expect(body.payments[1]).toMatchObject({ recommended: false, unavailable_reason: null });
    expect(body.payments[2].unavailable_reason).toBe("Jiná měna než na faktuře");
    expect(body.payments[3].unavailable_reason).toBe("Částka převyšuje zbývající úhradu");
    expect(body.remaining_amount).toBe(12440);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(query.eq.mock.calls).toEqual([["organization_id", "22222222-2222-4222-8222-222222222222"]]);
    expect(query.in).toHaveBeenCalledWith("match_status", ["unmatched", "ambiguous"]);
    expect(query.is).toHaveBeenCalledWith("invoice_id", null);
    expect(from).toHaveBeenNthCalledWith(1, "invoices");
    expect(from).toHaveBeenNthCalledWith(2, "bank_payments");
  });

  it("načte i doporučenou platbu za první stránkou výsledků", async () => {
    const first = paymentsChain({ data: Array.from({ length: 500 }, (_, i) => payment(`partial-${i}`, "100")), error: null });
    const second = paymentsChain({ data: [payment(SOME_UUID)], error: null });
    const from = vi.fn()
      .mockReturnValueOnce(fakeChain({ data: invoice, error: null }))
      .mockReturnValueOnce(first).mockReturnValueOnce(second);
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ service: { from } }));
    const body = await (await GET(fakeRequest(URL_), context)).json();
    expect(body.payments).toHaveLength(501);
    expect(body.payments[0].id).toBe(SOME_UUID);
    expect(first.range).toHaveBeenCalledWith(0, 499);
    expect(second.range).toHaveBeenCalledWith(500, 999);
    expect(first.order).toHaveBeenCalledWith("booked_on", { ascending: false });
    expect(first.order).toHaveBeenCalledWith("id", { ascending: true });
  });

  it("doporučuje podle zbývající částky, včetně haléřů", async () => {
    const from = vi.fn()
      .mockReturnValueOnce(fakeChain({ data: { ...invoice, amount: 100.30, paid_amount: 20.10 }, error: null }))
      .mockReturnValueOnce(fakeChain({ data: [payment("full", "100.30"), payment("remaining", "80.20")], error: null }));
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ service: { from } }));
    const body = await (await GET(fakeRequest(URL_), context)).json();
    expect(body.remaining_amount).toBe(80.20);
    expect(body.payments[0]).toMatchObject({ id: "remaining", recommended: true, unavailable_reason: null });
  });

  it("nenabízí platby k již uhrazené faktuře", async () => {
    const from = vi.fn().mockReturnValueOnce(fakeChain({ data: { ...invoice, status: "paid" }, error: null }));
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ service: { from } }));
    expect(await (await GET(fakeRequest(URL_), context)).json()).toEqual({ payments: [], remaining_amount: 0 });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("při chybě další stránky nevrací neúplný seznam", async () => {
    const from = vi.fn()
      .mockReturnValueOnce(fakeChain({ data: invoice, error: null }))
      .mockReturnValueOnce(fakeChain({ data: Array.from({ length: 500 }, (_, i) => payment(String(i))), error: null }))
      .mockReturnValueOnce(fakeChain({ data: null, error: { message: "read failed" } }));
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ service: { from } }));
    const response = await GET(fakeRequest(URL_), context);
    expect(response.status).toBe(500);
    expect((await response.json()).payments).toBeUndefined();
  });
});
