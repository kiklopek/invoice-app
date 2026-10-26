import { describe, expect, it } from "vitest";
import { exactMoney, summaryMoney, responsiveMoneyOptions } from "./money-display";

describe("financial display without changing source values", () => {
  it.each([
    [0, "0,00 Kč"], [0.01, "0,01 Kč"], [-1234.56, "-1 234,56 Kč"],
    [999999.99, "999 999,99 Kč"],
  ])("keeps the exact amount below a million: %s", (value, expected) => {
    expect(summaryMoney(value)).toEqual({ text: expected, exact: expected, compact: false });
  });
  it.each([
    [1000000, "1 mil. Kč"], [1817153.1, "1,817 mil. Kč"],
    [-2365000.55, "-2,365 mil. Kč"],
    [999999499, "999,999 mil. Kč"], [999999500, "1 mld. Kč"],
    [999999500000, "1 bil. Kč"], [2e12, "2 bil. Kč"],
  ])("uses consistent Czech summary units: %s", (value, expected) => {
    const result = summaryMoney(value);
    expect(result.text).toBe(expected);
    expect(result.exact).toBe(exactMoney(value));
    expect(result.compact).toBe(true);
  });
  it("retains haléře independently of the rounded summary and the currency", () => {
    expect(summaryMoney(1817153.1).exact).toBe("1 817 153,10 Kč");
    expect(summaryMoney(-2365000.55, "EUR").exact).toBe("-2 365 000,55 €");
    expect(summaryMoney(2365000.55, "USD").text).toContain("mil.");
    expect(exactMoney(0.99, "JPY")).toContain("0,99");
  });
  it.each([NaN, Infinity, -Infinity])("does not invent a financial amount for %s", value => {
    expect(summaryMoney(value)).toEqual({ text: "—", exact: "—", compact: false });
  });
});

describe("responsive financial alternatives", () => {
  it("starts with the precise value and includes thousands only as a fitting alternative", () => {
    expect(responsiveMoneyOptions(106192.02)).toEqual(["106 192,02 Kč", "106,192 tis. Kč", "106,19 tis. Kč", "106,2 tis. Kč", "106 tis. Kč"]);
    expect(responsiveMoneyOptions(.01)).toEqual(["0,01 Kč"]);
  });
  it.each([[2e6, "mil."], [2e9, "mld."], [2e12, "bil."]])("supports the Czech scale for %s", (value, unit) => {
    const options = responsiveMoneyOptions(value, "EUR");
    expect(options[0]).toBe(exactMoney(value, "EUR"));
    expect(options.at(-1)).toBe(`2 ${unit} €`);
  });
  it("promotes rounded units and preserves the sign", () => {
    expect(responsiveMoneyOptions(-999999.99).at(-1)).toBe("-1 mil. Kč");
    expect(responsiveMoneyOptions(999999999.99).at(-1)).toBe("1 mld. Kč");
    expect(responsiveMoneyOptions(999999999999.99).at(-1)).toBe("1 bil. Kč");
    expect(responsiveMoneyOptions(Infinity)).toEqual(["—"]);
  });
});
