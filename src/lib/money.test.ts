import { describe, expect, it } from "vitest";
import { minorUnits, money, multiplyRatio } from "./money";

// Jádro peněžní aritmetiky: používá ho párování plateb, routa faktur
// i kontrola GPC výpisu -- a nemělo jediný test. Chyba v zaokrouhlování
// se tu neprojeví pádem, ale haléřovým rozdílem, kvůli kterému se platba
// nespáruje a faktura zůstane viset jako neuhrazená.

describe("minorUnits", () => {
  it("converts crowns to halers", () => {
    expect(minorUnits(0)).toBe(0);
    expect(minorUnits(1)).toBe(100);
    expect(minorUnits("12100.50")).toBe(1210050);
    expect(minorUnits(-250.25)).toBe(-25025);
  });

  it("avoids the classic binary float traps", () => {
    // 0.1 + 0.2 = 0.30000000000000004; násobení stovkou to jen zhorší.
    expect(minorUnits(0.1 + 0.2)).toBe(30);
    // 1.005 * 100 je v plovoucí čárce 100.49999999999999 -- naivní
    // zaokrouhlení dolů by ukradlo haléř.
    expect(minorUnits(1.005)).toBe(101);
    expect(minorUnits(8.615)).toBe(862);
    expect(minorUnits(1.335)).toBe(134);
  });

  it("rounds half away from zero, symmetrically for both signs", () => {
    // Nesymetrické zaokrouhlení by u dobropisů dělalo jiný výsledek
    // než u faktur o stejné částce.
    expect(minorUnits(0.005)).toBe(1);
    expect(minorUnits(-0.005)).toBe(-1);
    expect(minorUnits(2.345)).toBe(235);
    expect(minorUnits(-2.345)).toBe(-235);
  });

  it("keeps only two decimal places", () => {
    expect(minorUnits("10.999")).toBe(1100);
    expect(minorUnits("10.994")).toBe(1099);
  });

  it("accepts the same value as text or as a number", () => {
    // Částky přicházejí z formuláře jako řetězec a z databáze jako číslo.
    expect(minorUnits("12100.50")).toBe(minorUnits(12100.5));
    expect(minorUnits(" 42.00 ")).toBe(minorUnits(42));
  });

  it("understands scientific notation, which JSON numbers can produce", () => {
    expect(minorUnits("1e2")).toBe(10000);
    expect(minorUnits("1.5e3")).toBe(150000);
    expect(minorUnits("1e-2")).toBe(1);
  });

  it("refuses anything that is not a number instead of silently returning zero", () => {
    // Tiché 0 by znamenalo fakturu na nula korun.
    for (const value of ["", " ", "abc", "12,50", "1.2.3", "NaN", "Infinity", "12 100"]) {
      expect(() => minorUnits(value), value).toThrow(/Neplatná peněžní částka/);
    }
  });

  it("refuses amounts outside the safe range instead of losing precision", () => {
    expect(() => minorUnits("1e40")).toThrow(/rozsah/);
    expect(() => minorUnits("999999999999999999")).toThrow(/rozsah/);
  });
});

describe("money", () => {
  it("returns a value that is exact to the haler", () => {
    expect(money("12100.50")).toBe(12100.5);
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money("-250.25")).toBe(-250.25);
  });
});

describe("multiplyRatio", () => {
  // Používá se při rozpouštění jedné platby mezi víc faktur: každá dostane
  // svůj podíl a součet musí sedět, jinak zůstane haléřový zbytek.
  it("splits an amount by a ratio", () => {
    expect(multiplyRatio(100, 1, 2)).toBe(50);
    expect(multiplyRatio(100, 1, 4)).toBe(25);
    expect(multiplyRatio(12100, 21, 121)).toBe(2100);
  });

  it("rounds the same way for negative amounts", () => {
    expect(multiplyRatio(-100, 1, 3)).toBe(-33.33);
    expect(multiplyRatio(100, 1, 3)).toBe(33.33);
  });

  it("rounds half away from zero, not toward it", () => {
    // 5 / 2 = 2,5 haléře -> 3, ne 2.
    expect(multiplyRatio(0.05, 1, 2)).toBe(0.03);
    expect(multiplyRatio(-0.05, 1, 2)).toBe(-0.03);
  });

  it("refuses a ratio that cannot be divided", () => {
    expect(() => multiplyRatio(100, 1, 0)).toThrow(/poměr/);
    expect(() => multiplyRatio(100, 1, -2)).toThrow(/poměr/);
  });

  it("never loses more than a haler across a split", () => {
    // Praktický důsledek: platba 1 000,01 rozdělená na tři faktury se
    // nesmí rozejít o víc než o zaokrouhlení jedné položky.
    const total = 1000.01;
    const parts = [1, 1, 1].map(() => multiplyRatio(total, 1, 3));
    const sum = parts.reduce((accumulator, part) => accumulator + part, 0);
    expect(Math.abs(minorUnits(sum) - minorUnits(total))).toBeLessThanOrEqual(2);
  });
});
