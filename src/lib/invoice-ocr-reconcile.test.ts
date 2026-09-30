import { describe, expect, it, vi } from "vitest";
import { deriveOcrFieldDecisions, omitUnverifiedOcrValues, type InvoiceOcrResult, type OcrFieldName, type OcrFieldSource } from "@/lib/invoice-ocr";
import { OCR_VOCABULARY_VERSION } from "@/lib/invoice-ocr-vocabulary";
import type { InvoiceInput } from "@/types/invoice";
import { parseConfidenceThreshold, reconcileExtractions } from "./invoice-ocr-reconcile";

const baseInvoice: InvoiceInput = {
  invoice_number: "260610",
  counterparty_name: "C.S.CARGO a.s.",
  counterparty_ico: "64259374",
  counterparty_dic: "CZ64259374",
  counterparty_email: "",
  variable_symbol: "",
  amount_without_vat: 12942.18,
  vat_rate: 21,
  amount: 15660,
  currency: "CZK",
  issue_date: "2026-09-02",
  due_date: "2026-09-16",
  source: "ocr",
};

function source(text: string, confidence: number | null = null): OcrFieldSource {
  return { page: 1, line: 1, text, method: "pdf_text", confidence, bounds: null };
}

function localResult(overrides: Partial<InvoiceInput> = {}, fieldSources: Partial<Record<OcrFieldName, OcrFieldSource>> = {}): InvoiceOcrResult {
  const invoice = { ...baseInvoice, ...overrides };
  return {
    invoice,
    field_sources: fieldSources,
    field_decisions: deriveOcrFieldDecisions(invoice, fieldSources, []),
    confidence: 0.86,
    warnings: [],
    document_kind: "issued_invoice",
    issuer_matches_organization: true,
    model: "local-tesseract-v3-geometry",
    response_id: null,
    vocabulary_version: OCR_VOCABULARY_VERSION,
    keyword_suggestions: [],
  };
}

function aiResult(overrides: Partial<InvoiceInput> = {}, fieldSources: Partial<Record<OcrFieldName, OcrFieldSource>> = {}, warnings: string[] = []): InvoiceOcrResult {
  const invoice = { ...baseInvoice, ...overrides };
  const resultWarnings = ["Tento dokument byl kvůli rozpoznání údajů odeslán externí AI službě (Google Gemini). Než fakturu uložíte, zkontrolujte všechny údaje.", ...warnings];
  return {
    invoice,
    field_sources: fieldSources,
    field_decisions: deriveOcrFieldDecisions(invoice, fieldSources, resultWarnings),
    confidence: 0.7,
    warnings: resultWarnings,
    document_kind: "issued_invoice",
    issuer_matches_organization: null,
    model: "gemini:gemini-3.5-flash-lite",
    response_id: "resp-1",
    vocabulary_version: OCR_VOCABULARY_VERSION,
    keyword_suggestions: [],
  };
}

describe("reconcileExtractions", () => {
  it("raises confidence when both engines agree on a field with an existing source", () => {
    const local = localResult({}, { amount: source("15660") });
    const ai = aiResult();
    const merged = reconcileExtractions(local, ai);
    expect(merged.field_sources.amount?.confidence).toBeGreaterThan(0);
    expect(merged.invoice.amount).toBe(15660);
    expect(merged.confidence).toBeGreaterThan(local.confidence);
  });

  it("never silently picks a winner on a money-field disagreement -- clears the field and retains both candidates", () => {
    const local = localResult({ amount_without_vat: 12942.18 }, { amount_without_vat: source("12 942,18", 0.9) });
    const ai = aiResult({ amount_without_vat: 15659.82 }, { amount_without_vat: source("15659.82") });
    const merged = reconcileExtractions(local, ai);
    expect(merged.invoice.amount_without_vat).toBe(0);
    expect(merged.field_sources.amount_without_vat).toBeUndefined();
    expect(merged.field_decisions.amount_without_vat).toMatchObject({ status: "review", confidence: 0 });
    expect(merged.field_decisions.amount_without_vat?.candidates.map(candidate => candidate.value)).toEqual([12942.18, 15659.82]);
    expect(merged.warnings.some(w => w.includes("základ daně") && w.includes("12942.18") && w.includes("15659.82"))).toBe(true);
    expect(merged.confidence).toBeLessThanOrEqual(0.35);
  });

  it("never silently picks a winner on a counterparty_ico disagreement", () => {
    const local = localResult({ counterparty_ico: "64259374" });
    const ai = aiResult({ counterparty_ico: "11111111" });
    const merged = reconcileExtractions(local, ai);
    expect(merged.invoice.counterparty_ico).toBe("");
    expect(merged.warnings.some(w => w.includes("IČO odběratele"))).toBe(true);
  });

  it("never silently picks a winner on a counterparty_dic disagreement", () => {
    const local = localResult({ counterparty_dic: "CZ64259374" }, { counterparty_dic: source("CZ64259374", 0.4) });
    const ai = aiResult({ counterparty_dic: "CZ64259999" }, { counterparty_dic: source("CZ64259999", 0.9) });
    const merged = reconcileExtractions(local, ai);
    expect(merged.invoice.counterparty_dic).toBe("");
    expect(merged.field_sources.counterparty_dic).toBeUndefined();
    expect(merged.warnings.some(w => w.includes("DIČ odběratele"))).toBe(true);
    expect(merged.confidence).toBeLessThanOrEqual(0.35);
  });

  it("clears a protected identity disagreement even when neither side has numeric confidence", () => {
    const local = localResult({ counterparty_dic: "CZ64259374" });
    const ai = aiResult({ counterparty_dic: "CZ64259999" });
    const merged = reconcileExtractions(local, ai);
    expect(merged.invoice.counterparty_dic).toBe("");
  });

  it("fills a field the local parser missed entirely from the AI result", () => {
    const local = localResult({ counterparty_email: "" });
    const ai = aiResult({ counterparty_email: "fakturace@example.cz" }, { counterparty_email: source("fakturace@example.cz") });
    const merged = reconcileExtractions(local, ai);
    expect(merged.invoice.counterparty_email).toBe("fakturace@example.cz");
    expect(merged.field_sources.counterparty_email?.method).toBe("pdf_text");
  });

  it("does not let AI reinsert identity data that the local parser tied to another named party", () => {
    const local = localResult({ counterparty_dic: "" });
    local.warnings.push("DIČ uvedené u jiné osoby nebo firmy nebylo přiřazeno odběrateli. Zkontrolujte DIČ ručně.");
    const ai = aiResult({ counterparty_dic: "CZ7311145842" }, { counterparty_dic: source("Robert Hlavica DIČ: CZ7311145842", 0.95) });

    const merged = reconcileExtractions(local, ai);

    expect(merged.invoice.counterparty_dic).toBe("");
    expect(merged.field_sources.counterparty_dic).toBeUndefined();
    expect(merged.warnings).toContain("DIČ uvedené u jiné osoby nebo firmy nebylo přiřazeno odběrateli. Zkontrolujte DIČ ručně.");
  });

  it("keeps the local value when only the local engine found a field", () => {
    const local = localResult({ variable_symbol: "260610" });
    const ai = aiResult({ variable_symbol: "" });
    const merged = reconcileExtractions(local, ai);
    expect(merged.invoice.variable_symbol).toBe("260610");
  });

  it("carries over the AI's own warnings (GDPR disclosure, self-IČO guard) even when fields agree", () => {
    const local = localResult();
    const ai = aiResult({}, {}, ["AI rozpoznala jako odběratele vaši vlastní firmu -- údaje byly vynechány, doplňte je ručně."]);
    const merged = reconcileExtractions(local, ai);
    expect(merged.warnings).toContain("AI rozpoznala jako odběratele vaši vlastní firmu -- údaje byly vynechány, doplňte je ručně.");
    expect(merged.warnings.some(w => w.includes("Google Gemini"))).toBe(true);
  });

  it("never overrides document_kind/issuer_matches_organization with the AI's uninformative defaults", () => {
    const local = localResult();
    const ai = aiResult();
    const merged = reconcileExtractions(local, ai);
    expect(merged.document_kind).toBe(local.document_kind);
    expect(merged.issuer_matches_organization).toBe(local.issuer_matches_organization);
  });

  it("a field only the AI read is not blanked because the local parser warned it was missing -- it waits for confirmation instead", () => {
    const local = localResult({ counterparty_name: "" });
    local.warnings.push("Název odběratele nebyl rozpoznán.");
    local.field_decisions = deriveOcrFieldDecisions(local.invoice, local.field_sources, local.warnings);
    const ai = aiResult({ counterparty_name: "WOOD & PAPER a.s." }, {
      counterparty_name: { page: 1, line: 0, text: "Odběratel: WOOD & PAPER a.s.", method: "ai", confidence: 0.65, bounds: null, role: "counterparty" },
    });

    const merged = reconcileExtractions(local, ai);

    expect(merged.warnings).not.toContain("Název odběratele nebyl rozpoznán.");
    expect(merged.field_decisions.counterparty_name).toMatchObject({ status: "review", needs_confirmation: true });
    expect(omitUnverifiedOcrValues(merged).invoice.counterparty_name).toBe("WOOD & PAPER a.s.");
  });

  it("the AI's own 'not recognized' warning does not demote a value the local parser did read", () => {
    const local = localResult({}, { counterparty_name: source("C.S.CARGO a.s.") });
    const ai = aiResult({ counterparty_name: "" }, {}, ["AI nerozpoznala jméno odběratele."]);
    const merged = reconcileExtractions(local, ai);
    expect(merged.field_decisions.counterparty_name?.status).toBe("verified");
    expect(omitUnverifiedOcrValues(merged).invoice.counterparty_name).toBe("C.S.CARGO a.s.");
  });

  it("keeps the local parser's multi-candidate review even when the AI agrees with the first candidate", () => {
    const local = localResult({}, { counterparty_ico: source("IČO 64259374") });
    local.field_decisions.counterparty_ico = {
      status: "review", confidence: 0.49, reasons: ["V potvrzené sekci odběratele bylo nalezeno více možných hodnot."],
      candidates: [
        { value: "64259374", page: 1, text: "IČO 64259374", method: "pdf_text", confidence: null, role: "counterparty" },
        { value: "27082440", page: 1, text: "IČO 27082440", method: "pdf_text", confidence: null, role: "counterparty" },
      ],
    };
    const merged = reconcileExtractions(local, aiResult());
    expect(merged.field_decisions.counterparty_ico?.status).toBe("review");
    expect(merged.field_decisions.counterparty_ico?.candidates).toHaveLength(2);
  });

  it("takes an explicitly reported AI document kind and shows the disagreement", () => {
    const local = localResult();
    const ai = { ...aiResult(), document_kind: "proforma" as const, document_kind_reported: true };
    const merged = reconcileExtractions(local, ai);
    expect(merged.document_kind).toBe("proforma");
    expect(merged.warnings.some(warning => warning.startsWith("Druh dokladu se liší"))).toBe(true);
    expect(merged.warnings).toContain("Dokument nemusí být běžná vydaná faktura. Před uložením ověřte jeho typ.");
  });

  it("an AI 'plain invoice' answer never overrides a local advance-invoice reading", () => {
    const local = { ...localResult(), document_kind: "proforma" as const };
    const ai = { ...aiResult(), document_kind: "issued_invoice" as const, document_kind_reported: true };
    expect(reconcileExtractions(local, ai).document_kind).toBe("proforma");
  });

  it("labels the combined model as local+gemini for traceability", () => {
    const merged = reconcileExtractions(localResult(), aiResult());
    expect(merged.model).toBe("local+gemini:gemini-3.5-flash-lite");
  });
});

describe("parseConfidenceThreshold", () => {
  it("falls back to 0.8 when unset", () => {
    expect(parseConfidenceThreshold(undefined)).toBe(0.8);
    expect(parseConfidenceThreshold("")).toBe(0.8);
  });

  it("accepts a valid value, including the [0,1] boundaries", () => {
    expect(parseConfidenceThreshold("0.8")).toBe(0.8);
    expect(parseConfidenceThreshold("0")).toBe(0);
    expect(parseConfidenceThreshold("1")).toBe(1);
  });

  it("warns and falls back on a non-numeric value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseConfidenceThreshold("abc")).toBe(0.8);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warns and falls back on the specific cost-multiplication bug case (80 instead of 0.8)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseConfidenceThreshold("80")).toBe(0.8);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warns and falls back on out-of-range values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseConfidenceThreshold("-0.1")).toBe(0.8);
    expect(parseConfidenceThreshold("1.5")).toBe(0.8);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("never warns for an unset value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseConfidenceThreshold(undefined);
    parseConfidenceThreshold("");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
