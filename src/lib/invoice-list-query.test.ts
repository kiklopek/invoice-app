import { describe, expect, it } from "vitest";
import { parseInvoiceListQuery } from "./invoice-list-query";

describe("invoice list query", () => {
  it("normalizes valid server-side filters", () => {
    expect(parseInvoiceListQuery(new URLSearchParams("q= FV-12 &status=overdue&currency=CZK&from=2026-01-01&to=2026-12-31&page=3"))).toEqual({
      query: "FV-12", status: "overdue", currency: "CZK", from: "2026-01-01", to: "2026-12-31", dueFrom: null, dueTo: null, amountMin: null, amountMax: null, paymentState: null, bankMatch: null, page: 3, pageSize: 25,
    });
    expect(parseInvoiceListQuery(new URLSearchParams("status=closed"))?.status).toBe("closed");
  });

  it("accepts only supported page sizes with a bounded default", () => {
    expect(parseInvoiceListQuery(new URLSearchParams())?.pageSize).toBe(25);
    for (const size of [10,25,50,100]) expect(parseInvoiceListQuery(new URLSearchParams(`page_size=${size}`))?.pageSize).toBe(size);
    for (const size of ["", "0", "500", "1000000", "25.5", "-10", "bad"]) expect(parseInvoiceListQuery(new URLSearchParams(`page_size=${size}`))).toBeNull();
  });

  it("rejects invalid periods, enums and unbounded input", () => {
    expect(parseInvoiceListQuery(new URLSearchParams("from=2026-12-31&to=2026-01-01"))).toBeNull();
    expect(parseInvoiceListQuery(new URLSearchParams("status=deleted"))).toBeNull();
    expect(parseInvoiceListQuery(new URLSearchParams("currency=czk"))).toBeNull();
    expect(parseInvoiceListQuery(new URLSearchParams(`q=${"x".repeat(101)}`))).toBeNull();
    expect(parseInvoiceListQuery(new URLSearchParams("page=0"))).toBeNull();
    expect(parseInvoiceListQuery(new URLSearchParams("amount_min=200&amount_max=100"))).toBeNull();
  });
});
