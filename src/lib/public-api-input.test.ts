import { describe, expect, it } from "vitest";
import { invoiceApiBody, apiOperationId, apiPage, encodeApiCursor } from "./public-api-input";

const body = () => ({
  issue_date: "2026-11-14", due_date: "2026-11-21", variable_symbol: "2600001",
  customer: { name: "Odběratel", address: "Testovací 1", email: "test@example.com" },
  items: [{ description: "Dřevo", quantity: "6", unit: "prms", unit_price_gross: "1700", vat_rate: 12 }],
  expected_total: "10200.00",
});
describe("public invoice contract", () => {
  it("normalizes decimal money without silently truncating and keeps mixed VAT", () => {
    const input = body(); input.items.push({ ...input.items[0], vat_rate: null as unknown as number });
    const parsed = invoiceApiBody(input);
    expect(parsed.items[0].unit_price_gross).toBe("1700");
    expect(parsed.items[1].vat_rate).toBeNull();
    expect(parsed.expected_total).toBe(10200);
    expect(parsed.customer.ico).toBe("");
  });
  it.each(["1.001", "NaN", "1e3", -1, null])("rejects invalid money %s", value => {
    expect(() => invoiceApiBody({ ...body(), expected_total: value })).toThrow();
  });
  it("rejects invalid calendar dates, unknown fields and unconfirmed payments", () => {
    expect(() => invoiceApiBody({ ...body(), issue_date: "2026-02-30" })).toThrow();
    expect(() => invoiceApiBody({ ...body(), organization_id: "other" })).toThrow();
    expect(() => invoiceApiBody({ ...body(), paid_amount: 10200 })).toThrow();
    expect(invoiceApiBody({ ...body(), paid_amount: 10200, payment_confirmed: true }).paid_amount).toBe(10200);
  });
  it("namespaces retry IDs by company and operation while keeping them stable", () => {
    const first = apiOperationId("org-a", "invoices", "order-1");
    expect(first).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(apiOperationId("org-a", "invoices", "order-1")).toBe(first);
    expect(apiOperationId("org-b", "invoices", "order-1")).not.toBe(first);
    expect(apiOperationId("org-a", "customers", "order-1")).not.toBe(first);
  });
  it("validates cursors and never places arbitrary text into a database filter", () => {
    const cursor = encodeApiCursor({ created_at: "2026-11-14T12:00:00.000Z", id: apiOperationId("a", "b", "c") });
    expect(apiPage(new URL(`https://example.com?limit=20&cursor=${cursor}`)).limit).toBe(20);
    expect(() => apiPage(new URL("https://example.com?limit=10000"))).toThrow();
    expect(() => apiPage(new URL("https://example.com?cursor=evil"))).toThrow();
  });
});
