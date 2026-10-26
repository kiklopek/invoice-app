import { describe, expect, it } from "vitest";
import {
  parseWorkspaceSearch,
  parseSearchAmount,
  paymentSearchPattern,
  paymentSearchFilter,
  validPaymentHighlight,
} from "./workspace-search";

describe("workspace search input", () => {
  it("trims a bounded literal query", () =>
    expect(parseWorkspaceSearch("  Štůšek  ")).toBe("Štůšek"));
  it.each(["x".repeat(101), "bad\nquery", "bad\u0000query"])(
    "rejects unsafe input",
    (value) => expect(parseWorkspaceSearch(value)).toBeNull(),
  );
  it.each([
    ["125 000,50 Kč", { amount: 125000.5, currency: "CZK" }],
    ["2600220", { amount: 2600220 }],
    ["10 €", { amount: 10, currency: "EUR" }],
  ] as const)(
    "recognizes exact amounts without losing invoice-number search: %s",
    (input, expected) => expect(parseSearchAmount(input)).toEqual(expected),
  );
  it.each(["-1", "1.2.3", "1e9", "1 2", "999999999999999999999999"])(
    "rejects ambiguous amounts: %s",
    (input) => expect(parseSearchAmount(input)).toBeNull(),
  );
  it("matches Czech names with and without accents", () => {
    const pattern = new RegExp(paymentSearchPattern("stusek"), "i");
    expect(pattern.test("Štůšek - DVB s.r.o.")).toBe(true);
    expect(new RegExp(paymentSearchPattern("Štůšek"), "i").test("STUSEK")).toBe(
      true,
    );
  });
  it("treats regex syntax and PostgREST syntax as literal text", () => {
    const query = 'a_b,or(id.eq.1)"\\.*';
    const pattern = new RegExp(paymentSearchPattern(query), "i");
    expect(pattern.test(query)).toBe(true);
    expect(pattern.test("anything")).toBe(false);
    const filter = paymentSearchFilter(query);
    expect(filter).toContain('counterparty_name.imatch."');
    expect(filter).toContain('\\"');
    expect(filter.match(/\.imatch\./g)).toHaveLength(6);
  });
  it("only accepts valid UUID payment targets", () => {
    expect(
      validPaymentHighlight("11111111-1111-4111-8111-111111111111"),
    ).toBeDefined();
    expect(validPaymentHighlight("other,org.eq.1")).toBeUndefined();
  });
});
