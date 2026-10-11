import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isLocale, resolveLocale } from "./locales";

describe("resolveLocale", () => {
  it("bez uložené volby je vždy čeština", () => {
    expect(DEFAULT_LOCALE).toBe("cs");
    expect(resolveLocale(undefined)).toBe("cs");
    expect(resolveLocale(null)).toBe("cs");
    expect(resolveLocale("")).toBe("cs");
  });

  it("platí volba z přepínače na landing page (cookie)", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("cs")).toBe("cs");
  });

  it("neplatná cookie spadne na češtinu", () => {
    expect(resolveLocale("xx")).toBe("cs");
    expect(resolveLocale("EN")).toBe("cs");
  });

  it("isLocale pozná jen podporované jazyky", () => {
    expect(isLocale("cs")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("EN")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
