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

function createScannedPdf(jpeg: Buffer, width: number, height: number) {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  const length = () => parts.reduce((total, part) => total + part.length, 0);
  const addObject = (number: number, body: Buffer | string) => {
    offsets[number] = length();
    parts.push(Buffer.from(`${number} 0 obj\n`), typeof body === "string" ? Buffer.from(body) : body, Buffer.from("\nendobj\n"));
  };
  const pageWidth = 612;
  const pageHeight = Math.round(pageWidth * height / width);
  const content = `q ${pageWidth} 0 0 ${pageHeight} 0 ${Math.round((792 - pageHeight) / 2)} cm /Im0 Do Q`;
  addObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObject(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  addObject(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>");
  addObject(4, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  addObject(5, Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
    jpeg,
    Buffer.from("\nendstream"),
  ]));
  const xrefOffset = length();
  parts.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return new Uint8Array(Buffer.concat(parts));
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

  it("renders and recognizes a scanned PDF through the bundled PDF worker", async () => {
    const jpeg = await sharp(Buffer.from('<svg width="1200" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="50" y="120" font-size="62" font-family="Arial" fill="black">FAKTURA FV-2026-008</text><text x="50" y="220" font-size="52" font-family="Arial" fill="black">Celkem 24 200 CZK</text></svg>')).jpeg({ quality: 95 }).toBuffer();
    const result = await extractInvoiceDocumentText({ bytes: createScannedPdf(jpeg, 1200, 320), mime: "application/pdf", timeoutMs: 25_000 });
    expect(result.ocrUsed).toBe(true);
    expect(result.pagesProcessed).toBe(1);
    expect(result.text).toContain("FV-2026-008");
  }, 30_000);
});
