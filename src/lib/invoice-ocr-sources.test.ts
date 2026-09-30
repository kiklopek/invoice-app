import { describe, expect, it } from "vitest";
import { deriveOcrFieldDecisions, omitUnverifiedOcrValues, type InvoiceOcrResult, type OcrFieldName, type OcrFieldSource } from "./invoice-ocr";
import { OCR_VOCABULARY_VERSION } from "./invoice-ocr-vocabulary";
import { applyOcrConsistencyChecks, mergeOcrSources, type ExactSourceReading } from "./invoice-ocr-sources";
import type { InvoiceInput } from "@/types/invoice";

const organization = { name: "M. Kolar, s.r.o.", ico: "16180330", dic: "CZ16180330" };

const invoice: InvoiceInput = {
  invoice_number: "1443260157", counterparty_name: "TIMBER & PULP a.s.", counterparty_ico: "46692011",
  counterparty_dic: "CZ46692011", counterparty_email: "", variable_symbol: "1443260157",
  amount_without_vat: 101735.7, vat_rate: 21, amount: 123100.2, currency: "CZK",
  issue_date: "2026-09-15", due_date: "2026-09-23", source: "ocr",
  money_evidence: { original_total: 123100.2, total_source: "read", adjustment: 0, adjustment_reason: "", adjustment_confirmed: false, initial_paid: 0, initial_paid_confirmed: false, multi_rate: false },
};

function result(method: OcrFieldSource["method"], overrides: Partial<InvoiceInput> = {}): InvoiceOcrResult {
  const merged = { ...invoice, ...overrides };
  const sources = Object.fromEntries((Object.keys(merged) as OcrFieldName[])
    .filter(field => ["invoice_number", "counterparty_name", "counterparty_ico", "counterparty_dic", "variable_symbol", "amount_without_vat", "vat_rate", "amount", "currency", "issue_date", "due_date"].includes(field))
    .map(field => [field, { page: 1, line: 1, text: String(merged[field as keyof InvoiceInput]), method, confidence: method === "ai" ? 0.65 : null, bounds: null, role: field.startsWith("counterparty_") ? "counterparty" : "document" }])) as Partial<Record<OcrFieldName, OcrFieldSource>>;
  return {
    invoice: merged, field_sources: sources, field_decisions: deriveOcrFieldDecisions(merged, sources, []),
    confidence: 0.9, warnings: [], document_kind: "issued_invoice", issuer_matches_organization: true,
    model: method, response_id: null, vocabulary_version: OCR_VOCABULARY_VERSION, keyword_suggestions: [],
  };
}

const isdoc = (values: ExactSourceReading["values"], extra: Partial<ExactSourceReading> = {}): ExactSourceReading => ({ method: "isdoc", label: "ISDOC příloha f.isdoc", values, ...extra });
const qr = (values: ExactSourceReading["values"]): ExactSourceReading => ({ method: "qr", label: "QR platba", values });

describe("pořadí zdrojů ISDOC > QR > ARES > AI > text", () => {
  it("přesný zdroj bez rozporu dá ověřené pole se svým zdrojem", () => {
    const merged = mergeOcrSources({ local: result("pdf_text"), exact: [qr({ amount: 123100.2, variable_symbol: "1443260157" })], organization });
    expect(merged.field_sources.amount?.method).toBe("qr");
    expect(merged.field_decisions.amount).toMatchObject({ status: "verified" });
    expect(merged.field_decisions.amount?.reasons[0]).toContain("shoduje se s: text PDF");
  });

  it("ISDOC vyplní pole, která text ani AI nepřečetly", () => {
    const merged = mergeOcrSources({ local: result("pdf_text", { invoice_number: "", counterparty_email: "" }), exact: [isdoc({ invoice_number: "1443260157", counterparty_email: "ucetni@timber-pulp.cz" })], organization });
    expect(merged.invoice).toMatchObject({ invoice_number: "1443260157", counterparty_email: "ucetni@timber-pulp.cz" });
    expect(merged.field_decisions.invoice_number?.status).toBe("verified");
  });

  it("ISDOC a QR se neshodují na částce: pole prázdné, obě hodnoty k volbě", () => {
    const merged = mergeOcrSources({ local: result("pdf_text"), exact: [isdoc({ amount: 123100.2 }), qr({ amount: 123000 })], organization });
    expect(merged.invoice.amount).toBe(0);
    expect(merged.field_decisions.amount?.status).toBe("review");
    expect(merged.field_decisions.amount?.candidates.map(candidate => [candidate.method, candidate.value])).toEqual([["isdoc", 123100.2], ["qr", 123000], ["pdf_text", 123100.2]]);
    expect(omitUnverifiedOcrValues(merged).invoice.amount).toBe(0);
  });

  it("přesný zdroj proti čtení dokumentu: žádný tichý vítěz ani pro ISDOC", () => {
    const merged = mergeOcrSources({ local: result("pdf_text", { variable_symbol: "1443260158" }), exact: [isdoc({ variable_symbol: "1443260157" })], organization });
    expect(merged.invoice.variable_symbol).toBe("");
    expect(merged.field_decisions.variable_symbol?.candidates.map(candidate => candidate.value)).toEqual(["1443260157", "1443260158"]);
    expect(merged.warnings.some(warning => warning.startsWith("Zdroje se neshodují na poli variabilní symbol"))).toBe(true);
  });

  it("QR částka k úhradě po odečtení zálohy není rozpor s celkovou hodnotou", () => {
    const local = result("pdf_text");
    local.invoice.money_evidence = { ...local.invoice.money_evidence!, initial_paid: 23100.2 };
    const merged = mergeOcrSources({ local, exact: [qr({ amount: 100000 })], organization });
    expect(merged.invoice.amount).toBe(123100.2);
    expect(merged.field_decisions.amount?.status).toBe("verified");
  });

  it("AI má přednost před textem jen tehdy, když se shodnou -- rozpor jde k ověření", () => {
    const merged = mergeOcrSources({ local: result("pdf_text"), ai: result("ai", { invoice_number: "1443260175" }), organization });
    expect(merged.invoice.invoice_number).toBe("");
    expect(merged.field_decisions.invoice_number?.status).toBe("review");
  });

  it("vezme druh dokladu z ISDOC a rozdíl oznámí", () => {
    const merged = mergeOcrSources({ local: result("pdf_text"), exact: [isdoc({}, { document_kind: "proforma" })], organization });
    expect(merged.document_kind).toBe("proforma");
    expect(merged.warnings.some(warning => warning.includes("ISDOC"))).toBe(true);
  });
});

describe("kontroly nad výsledkem", () => {
  it("základ + DPH ≠ celkem: hodnoty zůstanou, ale čekají na potvrzení", () => {
    const checked = applyOcrConsistencyChecks(result("pdf_text", { amount: 125000 }), organization);
    for (const field of ["amount", "amount_without_vat", "vat_rate"] as const) {
      expect(checked.field_decisions[field]).toMatchObject({ status: "review", needs_confirmation: true });
    }
    expect(checked.field_decisions.amount?.reasons.join(" ")).toContain("nedává celkovou částku");
  });

  it("splatnost před vystavením se nepředvyplní", () => {
    const checked = applyOcrConsistencyChecks(result("ai", { due_date: "2026-09-01" }), organization);
    expect(checked.invoice.due_date).toBe("");
    expect(checked.field_decisions.due_date?.candidates.map(candidate => candidate.value)).toContain("2026-09-01");
  });

  it("VS s písmeny nebo delší než 10 číslic se nepředvyplní", () => {
    expect(applyOcrConsistencyChecks(result("ai", { variable_symbol: "FV-2026-7" }), organization).invoice.variable_symbol).toBe("");
    expect(applyOcrConsistencyChecks(result("ai", { variable_symbol: "12345678901" }), organization).invoice.variable_symbol).toBe("");
  });

  it("IČO s chybnou kontrolní číslicí a DIČ firmy neodpovídající IČO jdou k ověření", () => {
    expect(applyOcrConsistencyChecks(result("ai", { counterparty_ico: "46692012", counterparty_dic: "" }), organization).invoice.counterparty_ico).toBe("");
    const checked = applyOcrConsistencyChecks(result("ai", { counterparty_dic: "CZ27182819" }), organization);
    expect(checked.invoice.counterparty_dic).toBe("");
    expect(checked.field_decisions.counterparty_dic?.reasons.join(" ")).toContain("neodpovídá IČO");
  });

  it("DIČ fyzické osoby (rodné číslo) se s IČO nesrovnává", () => {
    expect(applyOcrConsistencyChecks(result("ai", { counterparty_dic: "CZ7901011239" }), organization).invoice.counterparty_dic).toBe("CZ7901011239");
  });
});
