import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestIdentity } from "./auth";
const mocks = vi.hoisted(() => ({ invoices: vi.fn(), customers: vi.fn() }));
vi.mock("./invoice-list-page-data", () => ({
  loadInvoiceListPageData: mocks.invoices,
}));
vi.mock("./customer-search-data", () => ({ searchCustomers: mocks.customers }));
import { loadWorkspaceSearch } from "./workspace-search-data";
let identity: RequestIdentity;
let calls: Array<[string, ...unknown[]]>;
let paymentError: boolean;
beforeEach(() => {
  vi.resetAllMocks();
  calls = [];
  paymentError = false;
  mocks.invoices.mockResolvedValue({
    invoices: [
      {
        id: "invoice",
        invoice_number: "2600220",
        counterparty_name: "Štůšek",
        amount: 125000.5,
        currency: "CZK",
      },
    ],
  });
  mocks.customers.mockResolvedValue([
    {
      id: "customer",
      name: "Štůšek",
      ico: "12345678",
      email: "test@example.invalid",
    },
  ]);
  const from = vi.fn((table: string) => {
    expect(table).toBe("bank_payments");
    const chain: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then")
            return (resolve: (value: unknown) => void) =>
              resolve({
                data: paymentError
                  ? null
                  : [
                      {
                        id: "payment",
                        counterparty_name: "Štůšek",
                        amount: 125000.5,
                        currency: "CZK",
                        variable_symbol: "2600220",
                        booked_on: "2026-10-19",
                      },
                    ],
                error: paymentError ? { code: "unavailable" } : null,
              });
          return (...args: unknown[]) => {
            calls.push([String(prop), ...args]);
            return chain;
          };
        },
      },
    );
    return chain;
  });
  identity = {
    user: { id: "user" },
    membership: { organization_id: "org-one", role: "admin" },
    service: { from },
  } as unknown as RequestIdentity;
});
describe("tenant-scoped global search", () => {
  it("returns real entity links and searches all three types without dashboard date filters", async () => {
    const data = await loadWorkspaceSearch(identity, "stusek");
    expect(data.results.map((result) => result.type)).toEqual([
      "invoice",
      "customer",
      "payment",
    ]);
    expect(data.unavailable).toEqual([]);
    expect(data.results[1].href).toBe("/customers?highlight=customer");
    expect(data.results[2].href).toContain(
      "/invoices/payments/archive?highlight=payment#payment-payment",
    );
    expect(mocks.invoices.mock.calls[0][1]).toMatchObject({
      query: "stusek",
      from: null,
      to: null,
    });
    expect(calls).toContainEqual(["eq", "organization_id", "org-one"]);
    expect(calls).toContainEqual(["limit", 4]);
    expect(calls.some((call) => call[0] === "range")).toBe(false);
  });
  it("searches both literal invoice numbers/VS and exact amounts, then deduplicates", async () => {
    const data = await loadWorkspaceSearch(identity, "125 000,50 Kč");
    expect(mocks.invoices).toHaveBeenCalledTimes(2);
    expect(mocks.invoices.mock.calls[1][1]).toMatchObject({
      amountMin: 125000.5,
      amountMax: 125000.5,
      currency: "CZK",
      query: "",
    });
    expect(calls).toContainEqual(["eq", "amount", 125000.5]);
    expect(calls).toContainEqual(["eq", "currency", "CZK"]);
    expect(
      data.results.filter((result) => result.type === "invoice"),
    ).toHaveLength(1);
    expect(
      data.results.filter((result) => result.type === "payment"),
    ).toHaveLength(1);
  });
  it("never searches or exposes payment operations to a viewer", async () => {
    identity.membership.role = "viewer";
    const data = await loadWorkspaceSearch(identity, "stusek");
    expect(data.results.map((result) => result.type)).toEqual([
      "invoice",
      "customer",
    ]);
    expect(identity.service.from).not.toHaveBeenCalled();
  });
  it("keeps available entities and identifies a failed category", async () => {
    mocks.customers.mockRejectedValue(new Error("unavailable"));
    const data = await loadWorkspaceSearch(identity, "stusek");
    expect(data.results.map((result) => result.type)).toEqual([
      "invoice",
      "payment",
    ]);
    expect(data.unavailable).toEqual(["customer"]);
  });
  it("does not report an empty search when all sources fail", async () => {
    mocks.invoices.mockRejectedValue(new Error("unavailable"));
    mocks.customers.mockRejectedValue(new Error("unavailable"));
    paymentError = true;
    await expect(loadWorkspaceSearch(identity, "stusek")).rejects.toMatchObject(
      { status: 503 },
    );
  });
  it("does not query the inventory for an empty search", async () => {
    expect(await loadWorkspaceSearch(identity, "")).toEqual({
      results: [],
      unavailable: [],
    });
    expect(mocks.invoices).not.toHaveBeenCalled();
    expect(identity.service.from).not.toHaveBeenCalled();
  });
  it("requires an authorized identity before any read", async () => {
    await expect(loadWorkspaceSearch(null, "stusek")).rejects.toMatchObject({
      status: 401,
    });
    identity.membership.role =
      "unknown" as RequestIdentity["membership"]["role"];
    await expect(loadWorkspaceSearch(identity, "stusek")).rejects.toMatchObject(
      { status: 403 },
    );
    expect(mocks.invoices).not.toHaveBeenCalled();
    expect(identity.service.from).not.toHaveBeenCalled();
  });
});
