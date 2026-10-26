import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { extractInvoiceDocumentText } from "./invoice-ocr-server";
import { omitUnverifiedOcrValues, parseInvoiceText } from "./invoice-ocr";

const organization = { name: "Audit firma A", ico: "", dic: "", email: "" };
describe("audited two-column party regression", () => {
  it.each([["pdf", "application/pdf"], ["png", "image/png"]])("keeps supplier and customer separate in a real %s extraction", async (extension, mime) => {
    const bytes = await readFile(`src/test/fixtures/ocr-two-party-columns.${extension}`);
    const extracted = await extractInvoiceDocumentText({ bytes: new Uint8Array(bytes), mime, timeoutMs: 40000 });
    const result = parseInvoiceText({ text: extracted.text, layout: extracted.layout, organization, fileUrl: "fixture", ocrConfidence: extracted.averageConfidence });
    if (extension === "pdf") expect(result.invoice.counterparty_name).toBe("Audit odběratel B");
    else {
      expect(result.invoice.counterparty_name.normalize("NFD").replace(/\p{M}/gu, "")).toBe("Audit odberatel B");
      expect(result.field_decisions.counterparty_name?.status).toBe("review");
      expect(result.field_decisions.counterparty_name?.needs_confirmation).toBe(true);
    }
    expect(result.invoice.counterparty_name).not.toContain(organization.name);
    expect(result.invoice.amount).toBe(1210);
  }, 45000);
  it("withholds a merged name when geometry cannot separate the parties", () => {
    const result = parseInvoiceText({ text: "Faktura FV-1\nDodavatel Odběratel\nAudit firma A Audit odběratel B\nCelkem 1210 CZK", organization, fileUrl: "fixture" });
    expect(result.field_decisions.counterparty_name?.status).not.toBe("verified");
    expect(omitUnverifiedOcrValues(result).invoice.counterparty_name).toBe("");
  });
});
