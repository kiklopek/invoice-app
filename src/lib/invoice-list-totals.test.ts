import { describe, expect, it, vi } from "vitest";
import type { RequestIdentity } from "./auth";
import { parseInvoiceListQuery } from "./invoice-list-query";
import { loadInvoiceListTotals } from "./invoice-list-totals";
import { invoiceTotalsKey } from "./invoice-totals-key";
const query = parseInvoiceListQuery(
  new URLSearchParams(
    "status=paid&currency=CZK&from=2026-01-01&due_to=2026-12-31&amount_min=10&payment=partial&bank_match=matched&q=WOOD&page=8&page_size=10",
  ),
)!;
function fixture(
  rows: Array<{ id: string; amount: number; currency: string }>,
) {
  const rpc = vi.fn(
    async (
      _name: string,
      args: { page_number: number; page_size: number },
    ) => ({
      data: {
        total: rows.length,
        invoices: rows.slice(
          (args.page_number - 1) * args.page_size,
          args.page_number * args.page_size,
        ),
      },
      error: null,
    }),
  );
  const identity = {
    membership: { organization_id: "org-a" },
    user: { id: "user-a" },
    service: { rpc },
  } as unknown as RequestIdentity;
  return { identity, rpc };
}
describe("filtered invoice totals", () => {
  it("sums every matching invoice across RPC batches, not only the visible page", async () => {
    const { identity, rpc } = fixture(
      Array.from({ length: 503 }, (_, id) => ({
        id: String(id),
        amount: 0.1,
        currency: "CZK",
      })),
    );
    expect(await loadInvoiceListTotals(identity, query)).toEqual({ CZK: 50.3 });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "list_invoices_page_filtered",
      expect.objectContaining({
        target_org: "org-a",
        actor_user: "user-a",
        search_query: "WOOD",
        status_filter: "paid",
        currency_filter: "CZK",
        issue_from: "2026-01-01",
        due_to: "2026-12-31",
        amount_min: 10,
        payment_state: "partial",
        bank_match_state: "matched",
        page_number: 2,
        page_size: 500,
      }),
    );
  });
  it("keeps currencies separate and sums full amounts, including paid invoices", async () => {
    const { identity } = fixture([
      { id: "paid", amount: 125.35, currency: "CZK" },
      { id: "partial", amount: 0.15, currency: "CZK" },
      { id: "euro", amount: 100.01, currency: "EUR" },
    ]);
    expect(await loadInvoiceListTotals(identity, query)).toEqual({
      CZK: 125.5,
      EUR: 100.01,
    });
  });
  it("returns an empty total for no matching rows", async () => {
    expect(await loadInvoiceListTotals(fixture([]).identity, query)).toEqual(
      {},
    );
  });
  it("never queries without authenticated organization identity", async () => {
    await expect(loadInvoiceListTotals(null, query)).rejects.toThrow(
      "Nejste přihlášený",
    );
  });
  it("rejects missing or duplicated rows rather than displaying a partial sum", async () => {
    const { identity, rpc } = fixture([]);
    rpc.mockResolvedValueOnce({
      data: { total: 1, invoices: [] },
      error: null,
    });
    await expect(loadInvoiceListTotals(identity, query)).rejects.toThrow(
      "Součet faktur",
    );
    await expect(
      loadInvoiceListTotals(
        fixture([
          { id: "same", amount: 10, currency: "CZK" },
          { id: "same", amount: 10, currency: "CZK" },
        ]).identity,
        query,
      ),
    ).rejects.toThrow("Součet faktur");
  });
  it("shares a totals cache key across pages and sizes but preserves all filters", () => {
    expect(
      invoiceTotalsKey(
        "/api/invoices?paged=1&page=5&page_size=100&status=paid&currency=EUR&q=WOOD",
      ),
    ).toBe("/api/invoices/totals?status=paid&currency=EUR&q=WOOD");
    expect(invoiceTotalsKey("/api/invoices?paged=1&page=1")).toBe(
      "/api/invoices/totals",
    );
  });
});
