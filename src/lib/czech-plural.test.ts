import { describe, expect, it } from "vitest";
import { invoiceCountLabel } from "./czech-plural";

describe("počet faktur v češtině", () => {
  it("skloňuje podle čísla, ne jen podle jedničky", () => {
    expect(invoiceCountLabel(0)).toBe("0 faktur");
    expect(invoiceCountLabel(1)).toBe("1 faktura");
    expect(invoiceCountLabel(2)).toBe("2 faktury");
    expect(invoiceCountLabel(4)).toBe("4 faktury");
    expect(invoiceCountLabel(5)).toBe("5 faktur");
    expect(invoiceCountLabel(184)).toBe("184 faktur");
  });
});
