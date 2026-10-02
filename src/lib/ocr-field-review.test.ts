import { describe, expect, it } from "vitest";
import type { OcrFieldDecision } from "./invoice-ocr";
import { alternativeOcrCandidates, ocrSourceLabel, pendingOcrConfirmations } from "./ocr-field-review";

const needsConfirmation: OcrFieldDecision = { status: "review", confidence: 0.5, reasons: ["jen AI"], candidates: [], needs_confirmation: true };

describe("formulář: zdroj pole a potvrzení", () => {
  it("pojmenuje každý zdroj česky", () => {
    expect(["isdoc", "qr", "ares", "ai", "pdf_text", "ocr", "derived"].map(method => ocrSourceLabel(method as never)))
      .toEqual(["ISDOC", "QR platba", "ARES", "AI", "text", "text (OCR)", "dopočet"]);
  });

  it("dokud člověk hodnotu jen z jednoho zdroje nepotvrdí nebo nezmění, blokuje uložení", () => {
    const decisions = { counterparty_email: needsConfirmation, amount: { ...needsConfirmation } };
    const initial = { counterparty_email: "a@b.cz", amount: 3370 };
    expect(pendingOcrConfirmations(decisions, initial, { counterparty_email: "a@b.cz", amount: 3370 }, new Set())).toEqual(["counterparty_email", "amount"]);
    expect(pendingOcrConfirmations(decisions, initial, { counterparty_email: "a@b.cz", amount: 3370 }, new Set(["amount"]))).toEqual(["counterparty_email"]);
    expect(pendingOcrConfirmations(decisions, initial, { counterparty_email: "jiny@b.cz", amount: 3370 }, new Set(["amount"]))).toEqual([]);
    expect(pendingOcrConfirmations(decisions, initial, { counterparty_email: "", amount: 0 }, new Set())).toEqual([]);
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
