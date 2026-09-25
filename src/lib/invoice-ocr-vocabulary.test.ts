import { describe, expect, it } from "vitest";
import { findUnknownAccountingLabels, matchOcrConcept, normalizeOcrKeyword, OCR_VOCABULARY_VERSION } from "./invoice-ocr-vocabulary";

describe("invoice OCR vocabulary", () => {
  it("normalizes Czech and Slovak labels without losing their meaning", () => {
    expect(normalizeOcrKeyword("  Číslo faktúry:  ")).toBe("cislo faktury");
    expect(matchOcrConcept("Odběratel", "counterparty")?.exact).toBe(true);
    expect(matchOcrConcept("Dátum vystavenia", "issue_date")?.exact).toBe(true);
    expect(matchOcrConcept("Bill to", "counterparty")?.exact).toBe(true);
    expect(OCR_VOCABULARY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("tolerates a small OCR substitution only for sufficiently long terms", () => {
    expect(matchOcrConcept("Odberate1", "counterparty")).toMatchObject({ exact: false });
    expect(matchOcrConcept("V5", "variable_symbol")).toBeNull();
    expect(matchOcrConcept("VS", "variable_symbol")).toMatchObject({ exact: true });
    expect(matchOcrConcept("1C", "ico")).toBeNull();
  });

  it("recognizes negative supplier context independently of customer labels", () => {
    expect(matchOcrConcept("Bankovní spojení", "negative_party_context")).not.toBeNull();
    expect(matchOcrConcept("Dodavatel", "negative_party_context")).not.toBeNull();
    expect(matchOcrConcept("Dodavatel", "counterparty")).toBeNull();
  });

  it("suggests only unknown labels and never stores the value behind them", () => {
    expect(findUnknownAccountingLabels("Číslo faktury: FV-1\nEvidenční značka: SECRET-123\nE-mail: user@example.cz"))
      .toEqual([{ normalized_label: "evidencni znacka", example_label: "Evidenční značka" }]);
  });
});
