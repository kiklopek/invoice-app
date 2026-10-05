import { describe, expect, it } from "vitest";
import type { OcrFieldDecision } from "./invoice-ocr";
import { alternativeOcrCandidates, backfillOcrDraft, ocrSourceLabel } from "./ocr-field-review";
import type { InvoiceInput } from "@/types/invoice";

const needsConfirmation: OcrFieldDecision = { status: "review", confidence: 0.5, reasons: ["jen AI"], candidates: [], needs_confirmation: true };

describe("formulář: zdroj pole a potvrzení", () => {
  it("doplní prázdná pole staršího konceptu z nového OCR a zachová ruční změny", () => {
    const initial: InvoiceInput = {
      invoice_number: "FV-2026-001", variable_symbol: "2026001", issue_date: "2026-09-01", due_date: "2026-09-15",
      counterparty_name: "Odběratel", counterparty_ico: "25322257", counterparty_dic: "CZ25322257",
      counterparty_email: "faktury@example.cz", amount_without_vat: 1000, vat_rate: 21, amount: 1210, currency: "CZK", source: "ocr",
    };
    const draft = { ...initial, invoice_number: "RUČNÍ", variable_symbol: "", issue_date: "", due_date: "",
      counterparty_name: "", counterparty_ico: "", counterparty_dic: "", counterparty_email: "", amount_without_vat: 0, amount: 0, vat_rate: 0, currency: "" };
    const decisions = Object.fromEntries(Object.keys(initial).filter(field => field !== "source").map(field => [field, needsConfirmation]));
    const restored = backfillOcrDraft(draft, initial, decisions);
    expect(restored).toEqual({ ...initial, invoice_number: "RUČNÍ", vat_rate: 0 });
    expect(draft.counterparty_dic).toBe("");
    expect(backfillOcrDraft(draft, initial, undefined)).toEqual(draft);
  });

  it("pojmenuje každý zdroj česky", () => {
    expect(["isdoc", "qr", "ares", "ai", "pdf_text", "ocr", "derived"].map(method => ocrSourceLabel(method as never)))
      .toEqual(["ISDOC", "QR platba", "ARES", "AI", "text", "text (OCR)", "dopočet"]);
  });

  it("nabídne ke zvolení jen hodnoty, které se liší od aktuální", () => {
    const decision: OcrFieldDecision = {
      status: "review", confidence: 0, reasons: [],
      candidates: [
        { value: 123100.2, page: 1, text: "", method: "isdoc", confidence: 0.99, role: "document" },
        { value: 123000, page: 1, text: "", method: "qr", confidence: 0.99, role: "document" },
        { value: 123100.2, page: 1, text: "", method: "pdf_text", confidence: null, role: "document" },
      ],
    };
    expect(alternativeOcrCandidates(decision, 0).map(candidate => [candidate.value, candidate.sources])).toEqual([[123100.2, ["ISDOC", "text"]], [123000, ["QR platba"]]]);
    expect(alternativeOcrCandidates(decision, 123000).map(candidate => candidate.value)).toEqual([123100.2]);
  });

  it("nenabídne k převzetí kontakt ani identitu označenou jako vystavitel", () => {
    const decision: OcrFieldDecision = {
      status: "review", confidence: 0, reasons: [], candidates: [
        { value: "kostihova@hlavica.cz", page: 1, text: "Email vystavitele", method: "ocr", confidence: null, role: "issuer" },
        { value: "faktury@odberatel.cz", page: 1, text: "Email odběratele", method: "ocr", confidence: null, role: "counterparty" },
      ],
    };
    expect(alternativeOcrCandidates(decision, "")).toEqual([]);
  });
});
