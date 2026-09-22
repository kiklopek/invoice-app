import "server-only";

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { buildSpayd } from "@/lib/czech-payment";
import type { Invoice } from "@/types/invoice";

export type InvoicePdfCompany = {
  name: string;
  ico?: string | null;
  dic?: string | null;
  registered_address?: string | null;
  operating_address?: string | null;
  phone?: string | null;
  email?: string | null;
  bank_account_czk?: string | null;
  bank_account_eur?: string | null;
};

const PAGE_WIDTH = 595.28; // A4 at 72dpi
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;

// Standardni fonty pdf-lib umi jen WinAnsi (Windows-1252), kde chybi ceska
// pismena s hackem a krouzkem. Generator je drive transliteroval, takze na
// fakture, kterou zakaznik posila svemu odberateli, stalo "Dvorak" misto
// "Dvořák" a "Kc" misto "Kč".
//
// Reseni je vlozit skutecny font s Latin Extended-A. Liberation Sans uz je
// v projektu -- veze ho pdfjs-dist, ktery je primou zavislosti kvuli OCR --
// takze nepribyva zadny binarni soubor do repa. Je metricky kompatibilni
// s Helveticou, takze se rozvrzeni nemeni.
//
// POZOR: soubor se cte za behu z node_modules, takze musi byt v
// outputFileTracingIncludes v next.config.js pro kazdou routu, ktera PDF
// generuje. Bez toho na Vercelu chybi a generovani spadne.
const require_ = createRequire(import.meta.url);

function standardFontsDir() {
  return join(dirname(require_.resolve("pdfjs-dist/package.json")), "standard_fonts");
}

// Cteni z disku je synchronni a drahe, proto jen jednou na proces.
let fontBytesCache: { regular: Uint8Array; bold: Uint8Array } | null = null;

function loadFontBytes() {
  if (fontBytesCache) return fontBytesCache;
  const dir = standardFontsDir();
  fontBytesCache = {
    regular: new Uint8Array(readFileSync(join(dir, "LiberationSans-Regular.ttf"))),
    bold: new Uint8Array(readFileSync(join(dir, "LiberationSans-Bold.ttf"))),
  };
  return fontBytesCache;
}

function formatCzechDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("cs-CZ", { timeZone: "UTC" }).format(parsed);
}

function formatAmount(value: number, currency: string) {
  const formatted = new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
  return `${formatted} ${currency}`;
}

export function invoicePdfFilename(invoice: Invoice) {
  const safeNumber = invoice.invoice_number.replace(/[^A-Za-z0-9._-]/g, "") || "faktura";
  return `Faktura-${safeNumber}.pdf`;
}

export function invoicePdfResponse(bytes: Uint8Array, filename: string) {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}

// Drive se kreslilo na jednu pevnou A4 a `y` klesalo bez dolni hranice --
// dlouha poznamka se proto vykreslila pod spodni okraj a z dokumentu zmizela.
// Kurzor si drzi aktualni stranku a kdyz dojde misto, zalozi dalsi.
type Cursor = { doc: PDFDocument; page: PDFPage; y: number };

function newPage(cursor: Cursor) {
  cursor.page = cursor.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cursor.y = PAGE_HEIGHT - MARGIN;
}

function ensureSpace(cursor: Cursor, needed: number) {
  if (cursor.y - needed < MARGIN) newPage(cursor);
}

function drawText(
  cursor: Cursor,
  text: string,
  x: number,
  options: { font: PDFFont; size: number; color?: ReturnType<typeof rgb>; lineGap?: number },
) {
  const step = options.size + (options.lineGap ?? 6);
  ensureSpace(cursor, step);
  cursor.page.drawText(text, { x, y: cursor.y, font: options.font, size: options.size, color: options.color ?? rgb(0.1, 0.1, 0.1) });
  cursor.y -= step;
}

function drawKeyValueRow(cursor: Cursor, label: string, value: string, x: number, labelFont: PDFFont, valueFont: PDFFont) {
  ensureSpace(cursor, 16);
  cursor.page.drawText(label, { x, y: cursor.y, font: labelFont, size: 10, color: rgb(0.35, 0.35, 0.35) });
  cursor.page.drawText(value, { x: x + 190, y: cursor.y, font: valueFont, size: 10, color: rgb(0.1, 0.1, 0.1) });
  cursor.y -= 16;
}

export async function generateInvoicePdf(invoice: Invoice, company: InvoicePdfCompany): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Faktura ${invoice.invoice_number}`);

  const fontBytes = loadFontBytes();
  // subset: true vlozi jen skutecne pouzite glyfy. Bez toho by kazda faktura
  // nesla cely 136kB font a pripojovala ho ke kazde odeslane upomince.
  const font = await doc.embedFont(fontBytes.regular, { subset: true });
  const bold = await doc.embedFont(fontBytes.bold, { subset: true });

  const cursor: Cursor = { doc, page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]), y: PAGE_HEIGHT - MARGIN };
  const leftX = MARGIN;

  // Dodavatel
  drawText(cursor, company.name, leftX, { font: bold, size: 14, lineGap: 8 });
  if (company.ico) drawText(cursor, `IČO: ${company.ico}`, leftX, { font, size: 10, lineGap: 4 });
  if (company.dic) drawText(cursor, `DIČ: ${company.dic}`, leftX, { font, size: 10, lineGap: 4 });
  if (company.registered_address) drawText(cursor, company.registered_address, leftX, { font, size: 10, lineGap: 4 });
  if (company.operating_address && company.operating_address !== company.registered_address) {
    drawText(cursor, company.operating_address, leftX, { font, size: 10, lineGap: 4 });
  }
  const bankAccount = invoice.currency === "EUR" ? company.bank_account_eur : company.bank_account_czk;
  if (bankAccount) drawText(cursor, `Bankovní účet: ${bankAccount}`, leftX, { font, size: 10, lineGap: 4 });
  if (company.phone) drawText(cursor, `Tel.: ${company.phone}`, leftX, { font, size: 10, lineGap: 4 });
  if (company.email) drawText(cursor, `E-mail: ${company.email}`, leftX, { font, size: 10, lineGap: 4 });

  cursor.y -= 20;
  drawText(cursor, `FAKTURA č. ${invoice.invoice_number}`, leftX, { font: bold, size: 18, lineGap: 14 });

  // Odběratel
  drawText(cursor, "Odběratel", leftX, { font: bold, size: 11, lineGap: 6 });
  drawText(cursor, invoice.counterparty_name, leftX, { font, size: 10, lineGap: 4 });
  if (invoice.counterparty_ico) drawText(cursor, `IČO: ${invoice.counterparty_ico}`, leftX, { font, size: 10, lineGap: 4 });
  if (invoice.counterparty_dic) drawText(cursor, `DIČ: ${invoice.counterparty_dic}`, leftX, { font, size: 10, lineGap: 4 });
  if (invoice.counterparty_email) drawText(cursor, invoice.counterparty_email, leftX, { font, size: 10, lineGap: 4 });

  cursor.y -= 16;
  drawKeyValueRow(cursor, "Variabilní symbol:", invoice.variable_symbol ?? "—", leftX, font, font);
  drawKeyValueRow(cursor, "Datum vystavení:", formatCzechDate(invoice.issue_date), leftX, font, font);
  drawKeyValueRow(cursor, "Datum splatnosti:", formatCzechDate(invoice.due_date), leftX, font, font);
  drawKeyValueRow(cursor, "Forma úhrady:", "Bankovní převod", leftX, font, font);

  cursor.y -= 16;
  const remaining = Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount));
  const vatAmount = Number(invoice.amount) - Number(invoice.amount_without_vat);
  drawText(cursor, "Vyúčtování", leftX, { font: bold, size: 11, lineGap: 8 });
  drawKeyValueRow(cursor, "Částka bez DPH:", formatAmount(Number(invoice.amount_without_vat), invoice.currency), leftX, font, font);
  drawKeyValueRow(cursor, "Sazba DPH:", `${invoice.vat_rate} %`, leftX, font, font);
  drawKeyValueRow(cursor, "DPH:", formatAmount(vatAmount, invoice.currency), leftX, font, font);
  drawKeyValueRow(cursor, "Celkem k úhradě:", formatAmount(Number(invoice.amount), invoice.currency), leftX, bold, bold);
  drawKeyValueRow(cursor, "Uhrazeno:", formatAmount(Number(invoice.paid_amount), invoice.currency), leftX, font, font);
  drawKeyValueRow(cursor, "Zbývá uhradit:", formatAmount(remaining, invoice.currency), leftX, bold, bold);

  // QR platba. Vykresli se jen tehdy, kdyz je z ceho -- neuplny nebo
  // vymysleny QR kod je horsi nez zadny, protoze vypada funkcne a poslal by
  // penize jinam. buildSpayd proto pri pochybnostech vraci null.
  const spayd = buildSpayd({
    account: bankAccount,
    amount: remaining > 0 ? remaining : Number(invoice.amount),
    currency: invoice.currency,
    variableSymbol: invoice.variable_symbol,
    dueDate: invoice.due_date,
    message: `Faktura ${invoice.invoice_number}`,
  });
  if (spayd) {
    const QR_SIZE = 110;
    ensureSpace(cursor, QR_SIZE + 30);
    const png = await QRCode.toBuffer(spayd, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 440 });
    const image = await doc.embedPng(new Uint8Array(png));
    const qrTop = cursor.y;
    cursor.page.drawImage(image, { x: leftX, y: qrTop - QR_SIZE, width: QR_SIZE, height: QR_SIZE });
    cursor.page.drawText("QR platba", { x: leftX + QR_SIZE + 16, y: qrTop - 14, font: bold, size: 11, color: rgb(0.1, 0.1, 0.1) });
    cursor.page.drawText("Načtěte v mobilní bankovní aplikaci.", { x: leftX + QR_SIZE + 16, y: qrTop - 32, font, size: 9, color: rgb(0.35, 0.35, 0.35) });
    cursor.y = qrTop - QR_SIZE - 20;
  }

  if (invoice.notes) {
    cursor.y -= 16;
    drawText(cursor, "Poznámka", leftX, { font: bold, size: 11, lineGap: 6 });
    const maxWidth = PAGE_WIDTH - MARGIN * 2;
    let line = "";
    for (const word of invoice.notes.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, 10) > maxWidth && line) {
        drawText(cursor, line, leftX, { font, size: 10, lineGap: 4 });
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) drawText(cursor, line, leftX, { font, size: 10, lineGap: 4 });
  }

  const bytes = await doc.save();
  return bytes;
}
