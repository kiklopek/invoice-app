import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { companyNamesAgree, mergeCustomerReminderEmail, rejectOrganizationIdentity, validateCounterpartyWithAres } from "./invoice-ocr-registry";
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

  it("rejected identity candidates keep the box of the document line they came from", async () => {
    const result = slovakResult();
    result.invoice.counterparty_ico = "12345678";
    result.invoice.counterparty_dic = "";
    const bounds = { x: 0.55, y: 0.21, width: 0.2, height: 0.012 };
    result.field_sources.counterparty_ico = { page: 2, line: 7, text: "IČO: 12345678", method: "pdf_text", confidence: null, bounds, role: "counterparty" };
    const validated = await validateCounterpartyWithAres(result, {} as SupabaseClient<Database>);
    expect(validated.field_decisions.counterparty_ico?.candidates[0]).toMatchObject({ value: "12345678", page: 2, bounds });
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

describe("ARES jako nezávislý zdroj identity odběratele", () => {
  const client = {} as SupabaseClient<Database>;
  const found = (name: string, dic: string | null = "CZ46692011") => vi.fn(async () => ({
    status: "found" as const, cached: false, subject: { ico: "46692011", name, dic, address: null },
  }));

  function czechResult(overrides: Partial<InvoiceOcrResult["invoice"]> = {}): InvoiceOcrResult {
    const result = slovakResult();
    result.invoice = { ...result.invoice, counterparty_name: "TIMBER & PULP a.s.", counterparty_ico: "46692011", counterparty_dic: "CZ46692011", currency: "CZK", ...overrides };
    result.field_sources = {
      counterparty_ico: { page: 1, line: 4, text: "IČO: 46692011", method: "pdf_text", confidence: null, bounds: null },
      counterparty_name: { page: 1, line: 5, text: "TIMBER & PULP a.s.", method: "pdf_text", confidence: null, bounds: null },
    };
    result.field_decisions = deriveOcrFieldDecisions(result.invoice, result.field_sources, result.warnings);
    return result;
  }

  it("doplní prázdný název a DIČ z ARES se zdrojem ARES a nezahodí IČO", async () => {
    const result = czechResult({ counterparty_name: "", counterparty_dic: "" });
    result.warnings.push("Název odběratele nebyl rozpoznán.");
    const validated = await validateCounterpartyWithAres(result, client, { lookup: found("TIMBER & PULP a.s.") });
    expect(validated.invoice).toMatchObject({ counterparty_name: "TIMBER & PULP a.s.", counterparty_ico: "46692011", counterparty_dic: "CZ46692011" });
    expect(validated.field_sources.counterparty_name?.method).toBe("ares");
    expect(validated.field_decisions.counterparty_name?.status).toBe("verified");
    expect(validated.warnings).not.toContain("Název odběratele nebyl rozpoznán.");
  });

  it("ke klientovi přenese sídlo pouze po ověření IČO v ARES", async () => {
    const result = czechResult();
    const lookup = vi.fn(async () => ({ status: "found" as const, cached: false,
      subject: { ico: "46692011", name: "TIMBER & PULP a.s.", dic: "CZ46692011", address: "Dubová 38, Ivančice" } }));
    const validated = await validateCounterpartyWithAres(result, client, { lookup });
    expect(validated.counterparty_registered_address).toBe("Dubová 38, Ivančice");
  });

  it("ARES nerozhoduje mezi dvěma IČO odběratele", async () => {
    const result = czechResult();
    result.field_decisions.counterparty_ico = {
      status: "review", confidence: 0.4, reasons: ["Více IČO"],
      candidates: [
        { value: "46692011", page: 1, text: "IČO 46692011", method: "ocr", confidence: 0.8, role: "counterparty" },
        { value: "64259374", page: 1, text: "IČO 64259374", method: "ocr", confidence: 0.8, role: "counterparty" },
      ],
    };
    const lookup = vi.fn();
    expect(await validateCounterpartyWithAres(result, client, { lookup })).toBe(result);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("jiný název v dokumentu a v ARES: nic nepřepíše, obě hodnoty nabídne k volbě", async () => {
    const result = czechResult({ counterparty_name: "Úplně jiná firma s.r.o." });
    const validated = await validateCounterpartyWithAres(result, client, { lookup: found("TIMBER & PULP a.s.") });
    expect(validated.invoice.counterparty_name).toBe("");
    expect(validated.field_decisions.counterparty_name?.status).toBe("review");
    expect(validated.field_decisions.counterparty_name?.candidates.map(candidate => [candidate.value, candidate.method])).toEqual([
      ["Úplně jiná firma s.r.o.", "pdf_text"],
      ["TIMBER & PULP a.s.", "ares"],
    ]);
    expect(validated.invoice.counterparty_ico).toBe("");
  });

  it("rozdílné DIČ v dokumentu a v ARES jde k ověření s oběma hodnotami", async () => {
    const result = czechResult({ counterparty_dic: "CZ46692012" });
    const validated = await validateCounterpartyWithAres(result, client, { lookup: found("TIMBER & PULP a.s.") });
    expect(validated.invoice.counterparty_dic).toBe("");
    expect(validated.field_decisions.counterparty_dic?.candidates.map(candidate => candidate.value)).toEqual(["CZ46692012", "CZ46692011"]);
  });

  it("výpadek ARES je viditelné varování, ne blokace ani změna údajů", async () => {
    const result = czechResult();
    const validated = await validateCounterpartyWithAres(result, client, { lookup: vi.fn(async () => ({ status: "unavailable" as const, reason: "timeout" as const })) });
    expect(validated.invoice).toEqual(result.invoice);
    expect(validated.warnings.some(warning => warning.includes("ARES"))).toBe(true);
  });

  it("nesahá na rozhodnutí o polích, která s identitou nesouvisí", async () => {
    const result = czechResult();
    result.field_decisions.amount = { status: "review", confidence: 0.5, reasons: ["jen AI"], candidates: [], needs_confirmation: true };
    const validated = await validateCounterpartyWithAres(result, client, { lookup: found("TIMBER & PULP a.s.") });
    expect(validated.field_decisions.amount).toEqual(result.field_decisions.amount);
    expect(validated.field_decisions.counterparty_ico?.status).toBe("verified");
  });
});

describe("Kontakt uloženého klienta", () => {
  const organization = { name: "R. Hlavica s.r.o.", ico: "26296039", dic: "CZ26296039", email: "info@hlavica.cz" };
  function result(email: string) {
    const value = slovakResult();
    value.invoice.counterparty_ico = "46692011";
    value.invoice.counterparty_email = email;
    value.field_decisions = deriveOcrFieldDecisions(value.invoice, value.field_sources, []);
    return value;
  }

  it("předvyplní uložený e-mail pouze s povinným potvrzením", () => {
    const merged = mergeCustomerReminderEmail(result(""), "uctarna@timber-pulp.cz", organization);
    expect(merged.invoice.counterparty_email).toBe("uctarna@timber-pulp.cz");
    expect(merged.field_sources.counterparty_email?.method).toBe("customer");
    expect(merged.field_decisions.counterparty_email).toMatchObject({ status: "review", needs_confirmation: true });
  });

  it("při rozdílných adresách nepředvyplní žádnou a nabídne obě", () => {
    const merged = mergeCustomerReminderEmail(result("nova@timber-pulp.cz"), "stara@timber-pulp.cz", organization);
    expect(merged.invoice.counterparty_email).toBe("");
    expect(merged.field_decisions.counterparty_email?.candidates.map(candidate => candidate.value))
      .toEqual(["nova@timber-pulp.cz", "stara@timber-pulp.cz"]);
  });

  it("nikdy nenabídne e-mail vystavitele z uloženého klienta", () => {
    const original = result("");
    expect(mergeCustomerReminderEmail(original, "kostihova@hlavica.cz", organization)).toBe(original);
    expect(mergeCustomerReminderEmail(original, "nespravna-adresa", organization)).toBe(original);
  });
});
