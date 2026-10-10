import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isLocale, resolveLocale } from "./locales";

describe("resolveLocale", () => {
  it("dá přednost uložené volbě z cookie", () => {
    expect(resolveLocale("en", "cs-CZ,cs;q=0.9")).toBe("en");
    expect(resolveLocale("cs", "en-US,en;q=0.9")).toBe("cs");
  });

  it("bez cookie se řídí jazykem prohlížeče", () => {
    expect(resolveLocale(undefined, "en-US,en;q=0.9")).toBe("en");
    expect(resolveLocale(undefined, "en-GB")).toBe("en");
    expect(resolveLocale(undefined, "cs-CZ,cs;q=0.9,en;q=0.8")).toBe("cs");
    expect(resolveLocale(undefined, "sk-SK,sk;q=0.9,en;q=0.7")).toBe("en");
  });

  it("respektuje váhy q v Accept-Language", () => {
    expect(resolveLocale(undefined, "en;q=0.5,cs;q=0.9")).toBe("cs");
    expect(resolveLocale(undefined, "cs;q=0.2,en;q=0.8")).toBe("en");
  });

  it("neznámý jazyk, neplatná cookie a prázdná hlavička spadnou na češtinu", () => {
    expect(resolveLocale(undefined, "de-DE,de;q=0.9")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("xx", "de")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined, null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined, "")).toBe(DEFAULT_LOCALE);
    expect(DEFAULT_LOCALE).toBe("cs");
  });

  it("neplatná cookie nepřebije jazyk prohlížeče", () => {
    expect(resolveLocale("klingon", "en-US")).toBe("en");
  });

  it("isLocale pozná jen podporované jazyky", () => {
    expect(isLocale("cs")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("EN")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
