import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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

// pdf-lib's standard fonts only support WinAnsi (Windows-1252) encoding, which
// lacks the Czech letters that use a caron or ring above. Transliterate just
// those so arbitrary Czech invoice/company data never crashes PDF generation;
// WinAnsi-supported accents (á, é, í, ó, ú, ý, …) are left untouched.
const CZECH_WINANSI_FALLBACK: Record<string, string> = {
  č: "c", Č: "C",
  ď: "d", Ď: "D",
  ě: "e", Ě: "E",
  ň: "n", Ň: "N",
  ř: "r", Ř: "R",
  š: "s", Š: "S",
  ť: "t", Ť: "T",
  ů: "u", Ů: "U",
  ž: "z", Ž: "Z",
};

function pdfSafeText(value: string) {
  return [...value].map(char => CZECH_WINANSI_FALLBACK[char] ?? char).join("");
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

type DrawState = { y: number };

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  state: DrawState,
  options: { font: PDFFont; size: number; color?: ReturnType<typeof rgb>; lineGap?: number },
) {
  page.drawText(pdfSafeText(text), { x, y: state.y, font: options.font, size: options.size, color: options.color ?? rgb(0.1, 0.1, 0.1) });
  state.y -= options.size + (options.lineGap ?? 6);
}

function drawKeyValueRow(page: PDFPage, label: string, value: string, x: number, state: DrawState, labelFont: PDFFont, valueFont: PDFFont) {
  page.drawText(pdfSafeText(label), { x, y: state.y, font: labelFont, size: 10, color: rgb(0.35, 0.35, 0.35) });
  page.drawText(pdfSafeText(value), { x: x + 190, y: state.y, font: valueFont, size: 10, color: rgb(0.1, 0.1, 0.1) });
  state.y -= 16;
}

export async function generateInvoicePdf(invoice: Invoice, company: InvoicePdfCompany): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Faktura ${invoice.invoice_number}`);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const state: DrawState = { y: PAGE_HEIGHT - MARGIN };
  const leftX = MARGIN;

  // Company header (left column)
  const companyState: DrawState = { y: state.y };
  drawText(page, company.name, leftX, companyState, { font: bold, size: 14, lineGap: 8 });
  if (company.ico) drawText(page, `IČO: ${company.ico}`, leftX, companyState, { font, size: 10, lineGap: 4 });
  if (company.dic) drawText(page, `DIČ: ${company.dic}`, leftX, companyState, { font, size: 10, lineGap: 4 });
  if (company.registered_address) drawText(page, company.registered_address, leftX, companyState, { font, size: 10, lineGap: 4 });
  if (company.operating_address && company.operating_address !== company.registered_address) {
    drawText(page, company.operating_address, leftX, companyState, { font, size: 10, lineGap: 4 });
  }
  const bankAccount = invoice.currency === "EUR" ? company.bank_account_eur : company.bank_account_czk;
  if (bankAccount) drawText(page, `Bankovní účet: ${bankAccount}`, leftX, companyState, { font, size: 10, lineGap: 4 });
  if (company.phone) drawText(page, `Tel.: ${company.phone}`, leftX, companyState, { font, size: 10, lineGap: 4 });
  if (company.email) drawText(page, `E-mail: ${company.email}`, leftX, companyState, { font, size: 10, lineGap: 4 });

  state.y = companyState.y - 20;

  // Title
  drawText(page, `FAKTURA č. ${invoice.invoice_number}`, leftX, state, { font: bold, size: 18, lineGap: 14 });

  // Counterparty block
  const counterpartyState: DrawState = { y: state.y };
  drawText(page, "Odběratel", leftX, counterpartyState, { font: bold, size: 11, lineGap: 6 });
  drawText(page, invoice.counterparty_name, leftX, counterpartyState, { font, size: 10, lineGap: 4 });
  if (invoice.counterparty_ico) drawText(page, `IČO: ${invoice.counterparty_ico}`, leftX, counterpartyState, { font, size: 10, lineGap: 4 });
  if (invoice.counterparty_dic) drawText(page, `DIČ: ${invoice.counterparty_dic}`, leftX, counterpartyState, { font, size: 10, lineGap: 4 });
  if (invoice.counterparty_email) drawText(page, invoice.counterparty_email, leftX, counterpartyState, { font, size: 10, lineGap: 4 });

  state.y = counterpartyState.y - 16;

  // Key-value block
  drawKeyValueRow(page, "Variabilní symbol:", invoice.variable_symbol ?? "—", leftX, state, font, font);
  drawKeyValueRow(page, "Datum vystavení:", formatCzechDate(invoice.issue_date), leftX, state, font, font);
  drawKeyValueRow(page, "Datum splatnosti:", formatCzechDate(invoice.due_date), leftX, state, font, font);
  drawKeyValueRow(page, "Forma úhrady:", "Bankovní převod", leftX, state, font, font);

  state.y -= 16;

  // Amounts block
  const remaining = Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount));
  const vatAmount = Number(invoice.amount) - Number(invoice.amount_without_vat);
  drawText(page, "Vyúčtování", leftX, state, { font: bold, size: 11, lineGap: 8 });
  drawKeyValueRow(page, "Částka bez DPH:", formatAmount(Number(invoice.amount_without_vat), invoice.currency), leftX, state, font, font);
  drawKeyValueRow(page, "Sazba DPH:", `${invoice.vat_rate} %`, leftX, state, font, font);
  drawKeyValueRow(page, "DPH:", formatAmount(vatAmount, invoice.currency), leftX, state, font, font);
  drawKeyValueRow(page, "Celkem k úhradě:", formatAmount(Number(invoice.amount), invoice.currency), leftX, state, bold, bold);
  drawKeyValueRow(page, "Uhrazeno:", formatAmount(Number(invoice.paid_amount), invoice.currency), leftX, state, font, font);
  drawKeyValueRow(page, "Zbývá uhradit:", formatAmount(remaining, invoice.currency), leftX, state, bold, bold);

  if (invoice.notes) {
    state.y -= 16;
    drawText(page, "Poznámka", leftX, state, { font: bold, size: 11, lineGap: 6 });
    const words = invoice.notes.split(/\s+/);
    const maxWidth = PAGE_WIDTH - MARGIN * 2;
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(pdfSafeText(candidate), 10) > maxWidth && line) {
        drawText(page, line, leftX, state, { font, size: 10, lineGap: 4 });
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) drawText(page, line, leftX, state, { font, size: 10, lineGap: 4 });
  }

  const bytes = await doc.save();
  return bytes;
}
