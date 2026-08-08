import { describe, expect, it } from "vitest";
import { parseInvoiceListQuery } from "./invoice-list-query";

describe("invoice list query", () => {
  it("normalizes valid server-side filters", () => {
    expect(parseInvoiceListQuery(new URLSearchParams("q= FV-12 &status=overdue&currency=CZK&from=2026-01-01&to=2026-12-31&page=3"))).toEqual({
      query: "FV-12", status: "overdue", currency: "CZK", from: "2026-01-01", to: "2026-12-31", page: 3,
    });
    expect(parseInvoiceListQuery(new URLSearchParams("status=closed"))?.status).toBe("closed");
  });

  it("rejects invalid periods, enums and unbounded input", () => {
    expect(parseInvoiceListQuery(new URLSearchParams("from=2026-12-31&to=2026-01-01"))).toBeNull();
    expect(parseInvoiceListQuery(new URLSearchParams("status=deleted"))).toBeNull();
    expect(parseInvoiceListQuery(new URLSearchParams("currency=czk"))).toBeNull();
    expect(parseInvoiceListQuery(new URLSearchParams(`q=${"x".repeat(101)}`))).toBeNull();
    expect(parseInvoiceListQuery(new URLSearchParams("page=0"))).toBeNull();
  });
});
