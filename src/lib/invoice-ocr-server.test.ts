import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import { extractInvoiceDocumentText } from "./invoice-ocr-server";

function createTextPdf(text: string) {
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 16 Tf 50 740 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}

describe("local OCR document reader", () => {
  it("reads a text-native PDF without running image OCR", async () => {
    const result = await extractInvoiceDocumentText({
      bytes: createTextPdf("FAKTURA FV-2026-007 ODBERATEL STAVBY NOVAK CELKEM 12100 CZK DATUM VYSTAVENI 2026-08-01 SPLATNOST 2026-08-15"),
      mime: "application/pdf",
      timeoutMs: 15_000,
    });
    expect(result.ocrUsed).toBe(false);
    expect(result.totalPages).toBe(1);
    expect(result.text).toContain("FV-2026-007");
  });

  it("recognizes a generated invoice image with bundled Czech and English data", async () => {
    const image = await sharp(Buffer.from('<svg width="1200" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="50" y="120" font-size="62" font-family="Arial" fill="black">FAKTURA FV-2026-007</text><text x="50" y="220" font-size="52" font-family="Arial" fill="black">Celkem 12 100 CZK</text></svg>')).png().toBuffer();
    const result = await extractInvoiceDocumentText({ bytes: new Uint8Array(image), mime: "image/png", timeoutMs: 20_000 });
    expect(result.ocrUsed).toBe(true);
    expect(result.pagesProcessed).toBe(1);
    expect(result.text).toContain("FV-2026-007");
  }, 25_000);
});
