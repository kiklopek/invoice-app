import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { PDFDocument, rgb } from "pdf-lib";
import type { Supplier } from "@/lib/billing";
import { billingDocument, type BillingOrderForDocument } from "@/lib/billing-document";
import { formatCzk } from "@/lib/plans";

// PDF dokladu za předplatné Splatna. Fonty s češtinou z assets/fonts (stejné
// jako faktury zákazníků, viz invoice-pdf.ts -- ten je chráněná cesta, proto
// tady vlastní malé kreslení místo jeho úpravy).

let fonts: { regular: Uint8Array; bold: Uint8Array } | null = null;
function fontBytes() {
  if (!fonts) {
    const dir = join(process.cwd(), "assets", "fonts");
    fonts = {
      regular: new Uint8Array(readFileSync(join(dir, "LiberationSans-Regular.ttf"))),
      bold: new Uint8Array(readFileSync(join(dir, "LiberationSans-Bold.ttf"))),
    };
  }
  return fonts;
}

function czechDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day}. ${month}. ${year}`;
}

export async function generateBillingPdf(order: BillingOrderForDocument, supplier: Supplier) {
  const document = billingDocument(order, supplier);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(document.title);
  const font = await pdf.embedFont(fontBytes().regular, { subset: true });
  const bold = await pdf.embedFont(fontBytes().bold, { subset: true });
  const page = pdf.addPage([595.28, 841.89]);
  const ink = rgb(0.07, 0.14, 0.11);
  const muted = rgb(0.4, 0.45, 0.42);
  let y = 790;
  const line = (text: string, x: number, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(text, { x, y, size: options.size ?? 10, font: options.bold ? bold : font, color: options.color ?? ink });
  };
  const next = (gap = 14) => { y -= gap; };

  line("splatno", 50, { size: 20, bold: true }); next(30);
  line(document.title, 50, { size: 16, bold: true }); next(28);

  const top = y;
  line("Dodavatel", 50, { bold: true }); next();
  for (const text of [supplier.name, supplier.address, `IČO: ${supplier.ico}`, supplier.dic ? `DIČ: ${supplier.dic}` : "Neplátce DPH", `Účet: ${supplier.account}`]) { line(text, 50); next(); }
  y = top;
  line("Odběratel", 310, { bold: true }); next();
  const billing = order.billing;
  for (const text of [billing.name ?? "", billing.address ?? "", billing.ico ? `IČO: ${billing.ico}` : "", billing.dic ? `DIČ: ${billing.dic}` : "", billing.email ?? ""].filter(Boolean)) { line(text, 310); next(); }
  y = Math.min(y, top - 90) - 16;

  const rows: [string, string][] = [
    ["Objednávka", order.order_number],
    ["Variabilní symbol", order.variable_symbol],
    ["Datum vystavení", czechDate(document.issueDate)],
    ...(document.taxableDate ? [["Datum zdanitelného plnění", czechDate(document.taxableDate)] as [string, string]] : []),
    ...(document.paid ? [["Uhrazeno", "Ano"] as [string, string]] : [["Splatnost", czechDate(document.dueDate)] as [string, string]]),
  ];
  for (const [key, value] of rows) { line(key, 50, { color: muted }); line(value, 210); next(); }
  next(14);

  line("Položka", 50, { bold: true }); line("Částka", 470, { bold: true }); next(16);
  line(document.item, 50); line(formatCzk(order.net_halere).replace(/ /g, " "), 470); next(20);
  if (supplier.vatPayer) {
    line("Základ daně", 310, { color: muted }); line(formatCzk(order.net_halere).replace(/ /g, " "), 470); next();
    line("DPH 21 %", 310, { color: muted }); line(formatCzk(order.vat_halere).replace(/ /g, " "), 470); next();
  }
  line(document.paid ? "Celkem uhrazeno" : "Celkem k úhradě", 310, { bold: true }); line(formatCzk(order.gross_halere).replace(/ /g, " "), 470, { bold: true }); next(30);

  if (document.spayd) {
    const png = await QRCode.toBuffer(document.spayd, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 440 });
    const image = await pdf.embedPng(new Uint8Array(png));
    page.drawImage(image, { x: 50, y: y - 110, width: 110, height: 110 });
    page.drawText("QR platba", { x: 176, y: y - 14, font: bold, size: 11, color: ink });
    page.drawText("Načtěte v mobilní bankovní aplikaci. Tarif se aktivuje po připsání platby.", { x: 176, y: y - 32, font, size: 9, color: muted });
  }
  return { bytes: await pdf.save(), filename: document.filename };
}
