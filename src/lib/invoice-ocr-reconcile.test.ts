import { describe, expect, it, vi } from "vitest";
import type { InvoiceOcrResult, OcrFieldName, OcrFieldSource } from "@/lib/invoice-ocr";
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
  return {
    invoice: { ...baseInvoice, ...overrides },
    field_sources: fieldSources,
    confidence: 0.86,
    warnings: [],
    document_kind: "issued_invoice",
    issuer_matches_organization: true,
    model: "local-tesseract-v3-geometry",
    response_id: null,
  };
}

function aiResult(overrides: Partial<InvoiceInput> = {}, fieldSources: Partial<Record<OcrFieldName, OcrFieldSource>> = {}, warnings: string[] = []): InvoiceOcrResult {
  return {
    invoice: { ...baseInvoice, ...overrides },
    field_sources: fieldSources,
    confidence: 0.7,
    warnings: ["Tento dokument byl kvůli rozpoznání údajů odeslán externí AI službě (Google Gemini). Než fakturu uložíte, zkontrolujte všechny údaje.", ...warnings],
    document_kind: "issued_invoice",
    issuer_matches_organization: null,
    model: "gemini:gemini-3.5-flash-lite",
    response_id: "resp-1",
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

  it("never silently picks a winner on a money-field disagreement -- keeps local value, drops confidence, and warns with both numbers", () => {
    const local = localResult({ amount_without_vat: 12942.18 }, { amount_without_vat: source("12 942,18", 0.9) });
    const ai = aiResult({ amount_without_vat: 15659.82 }, { amount_without_vat: source("15659.82") });
    const merged = reconcileExtractions(local, ai);
    expect(merged.invoice.amount_without_vat).toBe(12942.18);
    expect(merged.field_sources.amount_without_vat?.confidence).toBeLessThanOrEqual(0.3);
    expect(merged.warnings.some(w => w.includes("základ daně") && w.includes("12942.18") && w.includes("15659.82"))).toBe(true);
    expect(merged.confidence).toBeLessThanOrEqual(0.35);
  });

  it("never silently picks a winner on a counterparty_ico disagreement", () => {
    const local = localResult({ counterparty_ico: "64259374" });
    const ai = aiResult({ counterparty_ico: "11111111" });
    const merged = reconcileExtractions(local, ai);
    expect(merged.invoice.counterparty_ico).toBe("64259374");
    expect(merged.warnings.some(w => w.includes("IČO odběratele"))).toBe(true);
  });

  it("resolves a non-money disagreement in favor of higher per-field confidence", () => {
    const local = localResult({ counterparty_dic: "CZ64259374" }, { counterparty_dic: source("CZ64259374", 0.4) });
    const ai = aiResult({ counterparty_dic: "CZ64259999" }, { counterparty_dic: source("CZ64259999", 0.9) });
    const merged = reconcileExtractions(local, ai);
    expect(merged.invoice.counterparty_dic).toBe("CZ64259999");
    expect(merged.warnings.some(w => w.includes("DIČ odběratele"))).toBe(true);
  });

  it("keeps the local value on a non-money disagreement when neither side has a numeric field confidence", () => {
    const local = localResult({ counterparty_dic: "CZ64259374" });
    const ai = aiResult({ counterparty_dic: "CZ64259999" });
    const merged = reconcileExtractions(local, ai);
    expect(merged.invoice.counterparty_dic).toBe("CZ64259374");
  });

  it("fills a field the local parser missed entirely from the AI result", () => {
    const local = localResult({ counterparty_email: "" });
    const ai = aiResult({ counterparty_email: "fakturace@example.cz" }, { counterparty_email: source("fakturace@example.cz") });
    const merged = reconcileExtractions(local, ai);
    expect(merged.invoice.counterparty_email).toBe("fakturace@example.cz");
    expect(merged.field_sources.counterparty_email?.method).toBe("pdf_text");
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
