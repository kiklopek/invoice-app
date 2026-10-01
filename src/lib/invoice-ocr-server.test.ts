import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import { extractInvoiceDocumentText, layoutPdfPage, layoutPdfTextItems } from "./invoice-ocr-server";
import { DAMAGED_TEXT_LAYER_WARNING } from "./invoice-ocr";

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
  it("reconstructs visual PDF rows from separately stored text columns", () => {
    const text = layoutPdfTextItems([
      { str: "MADREV s.r.o.", transform: [1, 0, 0, 1, 326, 687] },
      { str: "2600178", transform: [1, 0, 0, 1, 127, 685] },
      { str: "Odběratel :", transform: [1, 0, 0, 1, 275, 688] },
      { str: "Číslo faktury :", transform: [1, 0, 0, 1, 49, 685] },
      { str: "06.08.2026", transform: [1, 0, 0, 1, 431, 575] },
      { str: "Datum vystavení :", transform: [1, 0, 0, 1, 275, 575] },
    ]);

    expect(text).toBe("Číslo faktury : 2600178 Odběratel : MADREV s.r.o.\nDatum vystavení : 06.08.2026");
  });

  it("keeps page, line and normalized geometry for PDF fields", () => {
    const page = layoutPdfPage([
      { str: "Datum splatnosti:", transform: [12, 0, 0, 12, 40, 500], width: 110, height: 12 },
      { str: "20.08.2026", transform: [12, 0, 0, 12, 170, 500], width: 70, height: 12 },
    ], 2, 600, 800);

    expect(page.lines[0]).toMatchObject({ page: 2, line: 1, source: "pdf_text", text: "Datum splatnosti: 20.08.2026" });
    expect(page.lines[0].blocks).toHaveLength(2);
    expect(page.lines[0].bounds).toMatchObject({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) });
  });

  it("reads a text-native PDF without running image OCR", async () => {
    const result = await extractInvoiceDocumentText({
      bytes: createTextPdf("FAKTURA FV-2026-007 ODBERATEL STAVBY NOVAK CELKEM 12100 CZK DATUM VYSTAVENI 2026-08-01 SPLATNOST 2026-08-15"),
      mime: "application/pdf",
      timeoutMs: 15_000,
    });
    expect(result.ocrUsed).toBe(false);
    expect(result.totalPages).toBe(1);
    expect(result.text).toContain("FV-2026-007");
    expect(result.layout.pages[0].lines[0]).toMatchObject({ page: 1, source: "pdf_text" });
    // Vitest ma vychozi limit 5 s, ale tenhle test si sam povoluje 15 s. Pod
    // paralelnim behem cele sady ho prekracoval a padal nahodile, samostatne
    // prochazel -- vypadalo to jako regrese, byl to chybejici timeout.
    // Sesterske testy nize drzi stejny vzor: vnitrni rozpocet + 5 s rezerva.
  }, 20_000);

  it("recognizes a generated invoice image with bundled Czech and English data", async () => {
    const image = await sharp(Buffer.from('<svg width="1200" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="50" y="120" font-size="62" font-family="Arial" fill="black">FAKTURA FV-2026-007</text><text x="50" y="220" font-size="52" font-family="Arial" fill="black">Celkem 12 100 CZK</text></svg>')).png().toBuffer();
    const result = await extractInvoiceDocumentText({ bytes: new Uint8Array(image), mime: "image/png", timeoutMs: 20_000 });
    expect(result.ocrUsed).toBe(true);
    expect(result.pagesProcessed).toBe(1);
    const normalizedText = result.text.replace(/\s+/g, "");
    expect(normalizedText).toContain("FV-2026-007");
    expect(normalizedText).toContain("12100CZK");
    expect(result.layout.pages[0].lines.length).toBeGreaterThan(0);
    expect(result.layout.pages[0].lines[0].bounds).not.toBeNull();
  }, 25_000);

  it("auto-rotates and recognizes a mobile JPEG with shadows and small invoice text", async () => {
    const upright = await sharp(Buffer.from(`<svg width="1500" height="2200" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="shadow" x1="0" x2="1"><stop offset="0" stop-color="#f7f7f3"/><stop offset="1" stop-color="#b9b9b2"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#shadow)"/>
      <g font-family="Arial" fill="#252525" font-size="48">
        <text x="90" y="150" font-size="72" font-weight="bold">FAKTURA FV-2026-091</text>
        <text x="90" y="270">Dodavatel: Test Firma s.r.o.</text>
        <text x="90" y="350">ICO: 12345678</text>
        <text x="780" y="270">Odberatel: Zakaznik s.r.o.</text>
        <text x="780" y="350">ICO: 87654321</text>
        <text x="90" y="520">Datum vystaveni: 11.08.2026</text>
        <text x="90" y="600">Datum splatnosti: 25.08.2026</text>
        <text x="90" y="760">Popis polozky</text>
        <text x="900" y="760">Cena bez DPH</text>
        <text x="90" y="850">Sluzby</text>
        <text x="980" y="850">10 000,00 CZK</text>
        <text x="90" y="1850">DPH 21 %</text>
        <text x="980" y="1850">2 100,00 CZK</text>
        <text x="90" y="1960" font-weight="bold">CELKEM K UHRADE</text>
        <text x="980" y="1960" font-weight="bold">12 100,00 CZK</text>
      </g>
    </svg>`)).png().toBuffer();
    const mobilePhoto = await sharp(upright).rotate(270, { background: "white" }).jpeg({ quality: 82 }).withMetadata({ orientation: 6 }).toBuffer();
    const result = await extractInvoiceDocumentText({ bytes: new Uint8Array(mobilePhoto), mime: "image/jpeg", timeoutMs: 35_000 });
    expect(result.ocrUsed).toBe(true);
    expect(result.text).toMatch(/FV-2026-091/);
    expect(result.text).toMatch(/12\s*100[,.]00\s*CZK/i);
    expect(result.text).toMatch(/25[.]08[.]2026/);
  }, 40_000);

  it("renders and recognizes a scanned PDF through the bundled PDF worker", async () => {
    const jpeg = await sharp(Buffer.from('<svg width="1200" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="50" y="120" font-size="62" font-family="Arial" fill="black">FAKTURA FV-2026-008</text><text x="50" y="220" font-size="52" font-family="Arial" fill="black">Celkem 24 200 CZK</text></svg>')).jpeg({ quality: 95 }).toBuffer();
    const result = await extractInvoiceDocumentText({ bytes: createScannedPdf(jpeg, 1200, 320), mime: "application/pdf", timeoutMs: 25_000 });
    expect(result.ocrUsed).toBe(true);
    expect(result.pagesProcessed).toBe(1);
    expect(result.text).toContain("FV-2026-008");
  }, 30_000);
});

describe("přesné zdroje a poškozená textová vrstva v PDF", () => {
  async function pdfWith({ lines, attachment, qr }: { lines: string[]; attachment?: { name: string; xml: string }; qr?: string }) {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    lines.forEach((line, index) => page.drawText(line, { x: 50, y: 780 - index * 18, size: 11, font }));
    if (qr) {
      const QRCode = (await import("qrcode")).default;
      const png = await doc.embedPng(await QRCode.toBuffer(qr, { margin: 2, width: 240 }));
      page.drawImage(png, { x: 400, y: 60, width: 130, height: 130 });
    }
    if (attachment) await doc.attach(Buffer.from(attachment.xml, "utf8"), attachment.name, { mimeType: "application/xml" });
    return new Uint8Array(await doc.save());
  }

  it("přečte ISDOC přílohu PDF", async () => {
    const xml = '<?xml version="1.0"?><Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2"><ID>FV-1</ID></Invoice>';
    const result = await extractInvoiceDocumentText({ bytes: await pdfWith({ lines: ["FAKTURA FV-1 Odberatel Test s.r.o. Celkem 100 CZK"], attachment: { name: "faktura.isdoc", xml } }), mime: "application/pdf", timeoutMs: 15_000 });
    expect(result.isdoc).toEqual({ fileName: "faktura.isdoc", xml });
  }, 20_000);

  it("najde QR platbu na stránce PDF s textovou vrstvou", async () => {
    const spayd = "SPD*1.0*ACC:CZ3401000000006786420257*AM:3370.00*CC:CZK*X-VS:426198";
    const result = await extractInvoiceDocumentText({ bytes: await pdfWith({ lines: ["ZALOHOVA FAKTURA 426198 Celkem 3 370,00 CZK Datum vystaveni 02.09.2026"], qr: spayd }), mime: "application/pdf", timeoutMs: 15_000 });
    expect(result.qrCodes).toContain(spayd);
    expect(result.ocrUsed).toBe(false);
  }, 20_000);

  it("pozná textovou vrstvu bez č/ě/ř, zkusí OCR a ohlásí to", async () => {
    const result = await extractInvoiceDocumentText({
      bytes: await pdfWith({ lines: ["FAKTURA - da ovy doklad . 1443260157", "ODB RATEL: I O: 46692011", "DI : CZ46692011", "TIMBER & PULP a.s.", "K uhrad : 123 100,20 CZK"] }),
      mime: "application/pdf",
      timeoutMs: 30_000,
    });
    expect(result.warnings).toContain(DAMAGED_TEXT_LAYER_WARNING);
    expect(result.text).toMatch(/46692011/);
  }, 40_000);
});

describe("geometrie textové vrstvy PDF odpovídá zobrazené stránce", () => {
  const LINE_A = "FAKTURA FV-2026-117 Odberatel Stavby Novak s.r.o.";
  const LINE_B = "Celkem k uhrade 12 100,00 CZK splatnost 15.09.2026";
  const near = (actual: number, expected: number, tolerance = 0.01) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

  async function textPdf(setup: (page: import("pdf-lib").PDFPage, font: import("pdf-lib").PDFFont, lib: typeof import("pdf-lib")) => void) {
    const lib = await import("pdf-lib");
    const doc = await lib.PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const font = await doc.embedFont(lib.StandardFonts.Helvetica);
    setup(page, font, lib);
    return { bytes: new Uint8Array(await doc.save()), widthOf: (text: string) => font.widthOfTextAtSize(text, 12) };
  }

  it("posunutý MediaBox: box se počítá od levého horního rohu viditelné stránky", async () => {
    const { bytes, widthOf } = await textPdf((page, font) => {
      page.setMediaBox(100, 200, 600, 800);
      // 60 pt od levého okraje, účaří 100 pt od horního okraje viditelné stránky.
      page.drawText(LINE_A, { x: 160, y: 900, size: 12, font });
      page.drawText(LINE_B, { x: 160, y: 300, size: 12, font });
    });
    const result = await extractInvoiceDocumentText({ bytes, mime: "application/pdf", timeoutMs: 15_000 });
    expect(result.ocrUsed).toBe(false);
    const [first, second] = result.layout.pages[0].lines;
    expect(first.text).toBe(LINE_A);
    expect(second.text).toBe(LINE_B);
    near(first.bounds!.x, 60 / 600);
    near(first.bounds!.y + first.bounds!.height, 100 / 800);
    near(first.bounds!.width, widthOf(LINE_A) / 600);
    near(second.bounds!.x, 60 / 600);
    near(second.bounds!.y + second.bounds!.height, 700 / 800);
  }, 20_000);

  it("stránka s /Rotate 90: box sedí na otočené (zobrazené) stránce", async () => {
    const { bytes, widthOf } = await textPdf((page, font, lib) => {
      page.setRotation(lib.degrees(90));
      // Text otočený o 90° proti směru hodinek se po otočení stránky čte vodorovně.
      // Zobrazená stránka má 800 × 600; bod (x, y) stránky leží v náhledu na (y, x).
      page.drawText(LINE_A, { x: 450, y: 50, size: 12, font, rotate: lib.degrees(90) });
      page.drawText(LINE_B, { x: 500, y: 50, size: 12, font, rotate: lib.degrees(90) });
    });
    const result = await extractInvoiceDocumentText({ bytes, mime: "application/pdf", timeoutMs: 15_000 });
    expect(result.ocrUsed).toBe(false);
    const layoutPage = result.layout.pages[0];
    expect([layoutPage.width, layoutPage.height]).toEqual([800, 600]);
    const [first, second] = layoutPage.lines;
    expect(first.text).toBe(LINE_A);
    expect(second.text).toBe(LINE_B);
    near(first.bounds!.x, 50 / 800);
    near(first.bounds!.y + first.bounds!.height, 450 / 600);
    near(first.bounds!.width, widthOf(LINE_A) / 800);
    expect(first.bounds!.height).toBeLessThan(0.03);
    near(second.bounds!.y + second.bounds!.height, 500 / 600);
  }, 20_000);

  it("bez transformace zůstává geometrie beze změny (svislá osa PDF zdola nahoru)", () => {
    const page = layoutPdfPage([{ str: "Celkem", transform: [12, 0, 0, 12, 60, 700], width: 40, height: 12 }], 1, 600, 800);
    const bounds = page.lines[0].bounds!;
    expect([bounds.x, bounds.y, bounds.width, bounds.height].map(value => Number(value.toFixed(9))))
      .toEqual([0.1, (800 - 700 - 12) / 800, 40 / 600, 12 / 800].map(value => Number(value.toFixed(9))));
  });
});

describe("geometrie OCR obrázku odpovídá obrázku, který vidí prohlížeč", () => {
  const W = 1400;
  const H = 700;
  const svg = (body: string) => Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" fill="black" font-size="54">${body}</g></svg>`);
  const LEFT = '<text x="40" y="80">FAKTURA FV-2026-007</text>';
  const RIGHT = '<text x="900" y="200">Celkem 12 100 CZK</text>';
  // Skutečná poloha inkoustu v původním obrázku (normalizovaně), změřená
  // ořezem bílé plochy -- nezávisle na OCR.
  async function inkBox(body: string) {
    const { info } = await sharp(await sharp(svg(body)).png().toBuffer()).trim({ background: "#ffffff", threshold: 40 }).toBuffer({ resolveWithObject: true });
    const x = -(info.trimOffsetLeft ?? 0) / W;
    const y = -(info.trimOffsetTop ?? 0) / H;
    return { x, y, right: x + info.width / W, bottom: y + info.height / H };
  }

  it("odečte bílý okraj přidaný pro Tesseract, takže box sedí na inkoustu textu", async () => {
    const [left, right] = await Promise.all([inkBox(LEFT), inkBox(RIGHT)]);
    const image = await sharp(svg(LEFT + RIGHT)).png().toBuffer();
    const result = await extractInvoiceDocumentText({ bytes: new Uint8Array(image), mime: "image/png", timeoutMs: 40_000 });
    const page = result.layout.pages[0];
    const tolerance = 0.004;
    const leftLines = page.lines.filter(line => /FAKTURA|FV-2026/.test(line.text) && line.bounds);
    const rightLines = page.lines.filter(line => /Celkem|12\s?100|CZK/.test(line.text) && !/FAKTURA/.test(line.text) && line.bounds);
    expect(leftLines.length).toBeGreaterThan(0);
    expect(rightLines.length).toBeGreaterThan(0);
    // Řádek začínající u levého horního rohu: levý a horní okraj přesně.
    const first = leftLines.find(line => line.text.startsWith("FAKTURA"))!;
    expect(Math.abs(first.bounds!.x - left.x)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(first.bounds!.y - left.y)).toBeLessThanOrEqual(tolerance);
    // Každý přečtený řádek (i z detailního průchodu na výřezu) leží uvnitř
    // inkoustu svého textu.
    for (const [lines, ink] of [[leftLines, left], [rightLines, right]] as const) {
      for (const line of lines) {
        const bounds = line.bounds!;
        expect(bounds.x).toBeGreaterThanOrEqual(ink.x - tolerance);
        expect(bounds.y).toBeGreaterThanOrEqual(ink.y - tolerance);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(ink.right + tolerance);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(ink.bottom + tolerance);
      }
    }
    // Rozměr stránky v layoutu je rozměr dokumentu bez přidaného okraje.
    expect(page.width / page.height).toBeCloseTo(W / H, 2);
  }, 45_000);

  it("zesílený průchod (jiný okraj) mapuje boxy na stejný obrázek", async () => {
    // Šedý text na šedém pozadí: standardní průchod nestačí a vyhraje zesílený.
    const faint = (body: string) => Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#d0d0d0"/><g font-family="Arial" fill="#9a9a9a" font-size="30">${body}</g></svg>`);
    const body = '<text x="40" y="80">FAKTURA FV-2026-007</text>';
    const { info } = await sharp(await sharp(faint(body)).png().toBuffer()).trim({ background: "#d0d0d0", threshold: 20 }).toBuffer({ resolveWithObject: true });
    const ink = { x: -(info.trimOffsetLeft ?? 0) / W, y: -(info.trimOffsetTop ?? 0) / H };
    const result = await extractInvoiceDocumentText({ bytes: new Uint8Array(await sharp(faint(body)).png().toBuffer()), mime: "image/png", timeoutMs: 40_000 });
    expect(result.warnings).toContain("Fotografie vyžadovala zesílené OCR. Zkontrolujte předvyplněné údaje.");
    const first = result.layout.pages[0].lines.find(line => line.text.startsWith("FAKTURA"))!;
    expect(Math.abs(first.bounds!.x - ink.x)).toBeLessThanOrEqual(0.004);
    expect(Math.abs(first.bounds!.y - ink.y)).toBeLessThanOrEqual(0.004);
  }, 45_000);
});
