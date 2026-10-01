import { describe, expect, it } from "vitest";
import { findUnknownAccountingLabels, matchOcrConcept, normalizeOcrKeyword, OCR_VOCABULARY_VERSION, damagedLabelForm, hasDroppedGlyphLabels, repairDroppedGlyphLabels } from "./invoice-ocr-vocabulary";

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

  it("pozná běžné názvy fakturované strany bez záměny s příjemcem zboží či platby", () => {
    for (const label of ["Příjemce faktury", "Příjemce daňového dokladu", "Adresát faktury", "Fakturační adresa", "Fakturováno", "Billed to", "Billing address"]) {
      expect(matchOcrConcept(label, "counterparty")?.exact).toBe(true);
    }
    for (const label of ["Příjemce zboží", "Příjemce platby", "Příjemce"]) {
      expect(matchOcrConcept(label, "counterparty")).toBeNull();
    }
  });

  it("suggests only unknown labels and never stores the value behind them", () => {
    expect(findUnknownAccountingLabels("Číslo faktury: FV-1\nEvidenční značka: SECRET-123\nE-mail: user@example.cz"))
      .toEqual([{ normalized_label: "evidencni znacka", example_label: "Evidenční značka" }]);
  });
});

describe("poškozená textová vrstva (chybí č/ď/ě/ň/ř/ť/ů)", () => {
  it("opraví popisky odvozené z tištěné podoby a zachová velikost písmen", () => {
    const { text, repaired } = repairDroppedGlyphLabels("ODB RATEL: I O: 46692011\nDI : CZ46692011\nFAKTURA - da ový doklad . 1443\nK úhrad : 123 100,20 CZK\nIČ: 1\nI : 27182819");
    expect(text).toBe("ODBĚRATEL: IČO: 46692011\nDIČ : CZ46692011\nFAKTURA - daňový doklad . 1443\nK úhradě : 123 100,20 CZK\nIČ: 1\nIČ : 27182819");
    expect(repaired).toHaveLength(6);
  });

  it("nesahá na neporušený text ani na běžná slova", () => {
    const intact = "Odběratel: IČO: 46692011\nDIČ: CZ46692011\nčíslo faktury 1\nK úhradě 100 Kč\nDi Maio s.r.o.\ni o tom rozhodne";
    expect(repairDroppedGlyphLabels(intact)).toEqual({ text: intact, repaired: [] });
    expect(hasDroppedGlyphLabels(intact)).toBe(false);
    expect(damagedLabelForm("odběratel")).toBe("odb ratel");
  });
});
