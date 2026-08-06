import { describe, expect, it } from "vitest";
import { buildInvoiceOcrRequest, parseInvoiceOcrResponse } from "./invoice-ocr";

function response(payload: Record<string, unknown>) {
  return {
    id: "resp_123",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(payload) }] }],
  };
}

const validPayload = {
  document_kind: "issued_invoice",
  issuer_matches_organization: true,
  invoice_number: " FV-2026-7 ",
  counterparty_name: " Odběratel s.r.o. ",
  counterparty_ico: "12345678",
  counterparty_dic: "CZ12345678",
  counterparty_email: "FAKTURACE@EXAMPLE.CZ",
  variable_symbol: "202607",
  amount: 1250.456,
  currency: "czk",
  issue_date: "2026-08-01",
  due_date: "2026-08-15",
  notes: null,
  confidence: 0.94,
  warnings: [],
};

describe("invoice OCR", () => {
  it("normalizes a structured provider response into editable invoice data", () => {
    const result = parseInvoiceOcrResponse(response(validPayload), "org/file.pdf", "gpt-5.6-sol");
    expect(result?.invoice).toMatchObject({
      invoice_number: "FV-2026-7",
      counterparty_name: "Odběratel s.r.o.",
      counterparty_email: "fakturace@example.cz",
      amount: 1250.46,
      currency: "CZK",
      source: "ocr",
      file_url: "org/file.pdf",
    });
    expect(result?.response_id).toBe("resp_123");
  });

  it("drops invalid dates and adds high-risk document warnings", () => {
    const result = parseInvoiceOcrResponse(response({
      ...validPayload,
      document_kind: "other",
      issuer_matches_organization: false,
      issue_date: "01.08.2026",
      due_date: "2026-07-01",
      warnings: ["Nejasná částka"],
    }), "org/file.pdf", "model");
    expect(result?.invoice.issue_date).toBe("");
    expect(result?.invoice.due_date).toBe("2026-07-01");
    expect(result?.warnings.join(" ")).toContain("Vystavitel");
    expect(result?.warnings.join(" ")).toContain("nemusí být běžná vydaná faktura");
  });

  it("rejects malformed or non-structured output", () => {
    expect(parseInvoiceOcrResponse({ output: [] }, "x", "model")).toBeNull();
    expect(parseInvoiceOcrResponse({ output: [{ content: [{ type: "output_text", text: "not json" }] }] }, "x", "model")).toBeNull();
  });

  it("builds private base64 image input with strict schema and injection boundary", () => {
    const request = buildInvoiceOcrRequest({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/png",
      filename: "faktura.png",
      organization: { name: "R. Hlavica s.r.o.", ico: "05829309", dic: "CZ05829309" },
      model: "gpt-5.6-sol",
      safetyIdentifier: "hashed-user",
    });
    expect(request.store).toBe(false);
    expect(request.safety_identifier).toBe("hashed-user");
    expect(request.instructions).toContain("nedůvěryhodný zdroj dat");
    expect(request.text.format.strict).toBe(true);
    expect(JSON.stringify(request.input)).toContain("data:image/png;base64,AQID");
  });
});
