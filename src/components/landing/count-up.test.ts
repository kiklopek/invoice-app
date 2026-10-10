import { describe, expect, it } from "vitest";
import { countUpValue } from "./count-up";

describe("countUpValue", () => {
  it("začíná na nule a končí přesně na cíli", () => {
    expect(countUpValue(124, 0)).toBe(0);
    expect(countUpValue(124, 1)).toBe(124);
    expect(countUpValue(1_340_000, 1)).toBe(1_340_000);
  });

  it("drží se v mezích i mimo rozsah 0–1", () => {
    expect(countUpValue(124, -0.5)).toBe(0);
    expect(countUpValue(124, 1.5)).toBe(124);
  });

  it("roste monotónně a díky ease-out je v polovině přes půlku", () => {
    let previous = 0;
    for (let i = 0; i <= 20; i++) {
      const value = countUpValue(99, i / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(countUpValue(99, 0.5)).toBeGreaterThan(99 / 2);
  });

  it("během počítání zaokrouhluje na krok, na konci je přesný cíl", () => {
    for (let i = 1; i < 20; i++) {
      expect(countUpValue(1_340_000, i / 20, 1000) % 1000).toBe(0);
    }
    expect(countUpValue(1_340_500, 1, 1000)).toBe(1_340_500);
  });
});
