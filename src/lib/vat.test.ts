import { describe, expect, it } from "vitest";
import { grossFromNet, netFromGross, vatAmountsMatch } from "./vat";

describe("VAT calculations", () => {
  it("calculates gross from net and back", () => {
    expect(grossFromNet(10_000, 21)).toBe(12_100);
    expect(netFromGross(12_100, 21)).toBe(10_000);
  });

  it("rounds monetary values to cents", () => {
    expect(grossFromNet(100.01, 21)).toBe(121.01);
    expect(netFromGross(121.01, 21)).toBe(100.01);
  });

  it("accepts zero VAT and detects inconsistent totals", () => {
    expect(grossFromNet(500, 0)).toBe(500);
    expect(vatAmountsMatch(500, 0, 500)).toBe(true);
    expect(vatAmountsMatch(500, 21, 500)).toBe(false);
  });

  it("tolerates the small rounding residual real invoices carry (e.g. a 'Není předmětem DPH' bucket), without accepting an actually wrong total", () => {
    // Real invoice: základ 12 942 Kč at 21% -> 15 659,82 Kč, but the invoice's
    // own stated total is 15 660,00 Kč because of an unrelated 0,18 Kč
    // "not subject to VAT" line elsewhere on the document.
    expect(vatAmountsMatch(12942, 21, 15660)).toBe(true);
    // A 10 Kč gap (a real data-entry mistake, not rounding) must still fail.
    expect(vatAmountsMatch(1000, 21, 1200)).toBe(false);
  });
});
