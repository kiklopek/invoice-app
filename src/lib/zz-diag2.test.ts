import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { extractInvoiceDocumentText } from "./invoice-ocr-server";
import { parseInvoiceText } from "./invoice-ocr";

const organization = { name: "R. Hlavica s.r.o.", ico: "26296039", dic: "CZ26296039" };

describe("diag2", () => {
  it("extracts 260633", async () => {
    const bytes = new Uint8Array(readFileSync("/Users/tadeastrnka/Downloads/Faktura_260633.PDF"));
    const extracted = await extractInvoiceDocumentText({ bytes, mime: "application/pdf" });
    console.log("--- RAW TEXT ---");
    console.log(extracted.text);
    const parsed = parseInvoiceText({ text: extracted.text, fileUrl: "x", organization, layout: extracted.layout });
    console.log("--- PARSED ---");
    console.log(JSON.stringify(parsed.invoice, null, 2));
  }, 60000);
});
