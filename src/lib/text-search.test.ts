import { describe, expect, it } from "vitest";
import { createTextMatcher, searchFields } from "./text-search";

describe("text search", () => {
  const fields = searchFields(["Novák & synové", "FV-2026/001", "info@novak.cz", "+420 777 123 456", "CZ12345678", "Dlouhá 12, Brno", null]);

  it.each(["novak", "SYNOVE novak", "  Brno   NOVÁK  ", "novak 2026", "FV2026001", "777123456", "777 123", "CZ1234", "info@novak.cz", "Dlouha", "Nova\u0301k", ""])('matches "%s" across fields', (query) => {
    expect(createTextMatcher(query)(fields)).toBe(true);
  });

  it.each(["novak ostrava", "FV2026002", "%", "_", "a,or(id.eq.1)", "cizifirma"])('does not broaden "%s"', (query) => {
    expect(createTextMatcher(query)(fields)).toBe(false);
  });

  it("does not combine separate fields into an identifier", () => {
    expect(createTextMatcher("123456")(searchFields(["123", "456"]))).toBe(false);
  });
});
