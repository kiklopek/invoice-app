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
});
