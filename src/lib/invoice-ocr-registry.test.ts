import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { companyNamesAgree, rejectOrganizationIdentity, validateCounterpartyWithAres } from "./invoice-ocr-registry";
import { deriveOcrFieldDecisions, type InvoiceOcrResult } from "./invoice-ocr";
import { OCR_VOCABULARY_VERSION } from "./invoice-ocr-vocabulary";

function slovakResult(): InvoiceOcrResult {
  const invoice = {
    invoice_number: "FV-1", variable_symbol: "1", counterparty_name: "Slovenská sporiteľňa, a.s.",
    counterparty_ico: "35815256", counterparty_dic: "SK2020259802", counterparty_email: "faktury@example.sk",
    amount_without_vat: 100, vat_rate: 20, amount: 120, currency: "EUR", issue_date: "2026-09-01",
    due_date: "2026-09-15", notes: "", source: "ocr" as const, file_url: "org/test.pdf",
  };
  return {
    invoice, field_sources: {}, field_decisions: deriveOcrFieldDecisions(invoice, {}, []), confidence: 0.9,
    warnings: [], document_kind: "issued_invoice", issuer_matches_organization: true,
    model: "test", response_id: null, vocabulary_version: OCR_VOCABULARY_VERSION,
    keyword_suggestions: [],
  };
}

describe("OCR company registry validation", () => {
  it("compares names while ignoring common legal-form spelling", () => {
    expect(companyNamesAgree("ACME Solutions s.r.o.", "ACME Solutions, spol. s r.o.")).toBe(true);
    expect(companyNamesAgree("ACME Systems s.r.o.", "Other Systems a.s.")).toBe(false);
    expect(companyNamesAgree("Robert Hlavica", "Martin Kresta")).toBe(false);
  });

  it("does not send explicitly Slovak identities to Czech ARES", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const result = slovakResult();
    await expect(validateCounterpartyWithAres(result, {} as SupabaseClient<Database>)).resolves.toBe(result);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("rejects an invalid checksum but keeps the candidate as review evidence", async () => {
    const result = slovakResult();
    result.invoice.counterparty_ico = "12345678";
    result.invoice.counterparty_dic = "CZ12345678";
    const validated = await validateCounterpartyWithAres(result, {} as SupabaseClient<Database>);
    expect(validated.invoice.counterparty_ico).toBe("");
    expect(validated.invoice.counterparty_dic).toBe("");
    expect(validated.field_decisions.counterparty_ico).toMatchObject({ status: "review" });
    expect(validated.field_decisions.counterparty_ico?.candidates[0]?.value).toBe("12345678");
  });

  it("never prefills the account owner's IČO as the counterparty", () => {
    const result = slovakResult();
    result.invoice.counterparty_name = "R. Hlavica s.r.o.";
    result.invoice.counterparty_ico = "64259374";
    result.invoice.counterparty_dic = "CZ64259374";
    result.field_sources.counterparty_ico = {
      page: 1, line: 3, text: "IČO 64259374", method: "ocr", confidence: 0.96, bounds: null, role: "unknown",
    };

    const guarded = rejectOrganizationIdentity(result, {
      name: "R. Hlavica s.r.o.", ico: "64259374", dic: "CZ64259374",
    });

    expect(guarded.invoice.counterparty_ico).toBe("");
    expect(guarded.invoice.counterparty_dic).toBe("");
    expect(guarded.field_decisions.counterparty_ico).toMatchObject({ status: "review" });
    expect(guarded.field_decisions.counterparty_ico?.candidates).toEqual([
      expect.objectContaining({ value: "64259374", role: "issuer" }),
    ]);
    expect(guarded.warnings).toContain("IČO vlastní firmy bylo nalezeno v údajích odběratele a nebylo předvyplněno. Doplňte IČO firmy, která má fakturu zaplatit.");
  });

  it("leaves a genuinely different counterparty identity unchanged", () => {
    const result = slovakResult();
    expect(rejectOrganizationIdentity(result, {
      name: "R. Hlavica s.r.o.", ico: "64259374", dic: "CZ64259374",
    })).toBe(result);
  });
});
