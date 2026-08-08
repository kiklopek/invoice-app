import type { InvoiceInput } from "@/types/invoice";
import { MAX_VAT_RATE, grossFromNet, netFromGross, roundMoney, vatAmountsMatch } from "./vat";

const MAX_AMOUNT = 999_999_999_999.99;

function text(body: Record<string, unknown>, key: string, maxLength: number) {
  if (typeof body[key] !== "string") return "";
  return body[key].trim().slice(0, maxLength + 1);
}

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.toISOString().slice(0, 10) === value;
}

export function parseInvoiceInput(value: unknown): InvoiceInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const invoiceNumber = text(body, "invoice_number", 100);
  const counterpartyName = text(body, "counterparty_name", 200);
  const email = text(body, "counterparty_email", 254).toLowerCase();
  const issueDate = text(body, "issue_date", 10);
  const dueDate = text(body, "due_date", 10);
  const currency = (text(body, "currency", 3) || "CZK").toUpperCase();
  const amount = Number(body.amount);
  const hasNetAmount = body.amount_without_vat !== undefined && body.amount_without_vat !== null && body.amount_without_vat !== "";
  const hasVatRate = body.vat_rate !== undefined && body.vat_rate !== null && body.vat_rate !== "";
  const vatRate = hasVatRate ? Number(body.vat_rate) : 0;
  const amountWithoutVat = hasNetAmount ? Number(body.amount_without_vat) : netFromGross(amount, vatRate);

  if (
    !invoiceNumber || invoiceNumber.length > 100 ||
    !counterpartyName || counterpartyName.length > 200 ||
    !email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email) ||
    !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT ||
    !Number.isFinite(amountWithoutVat) || amountWithoutVat <= 0 || amountWithoutVat > MAX_AMOUNT ||
    !Number.isFinite(vatRate) || vatRate < 0 || vatRate > MAX_VAT_RATE ||
    !vatAmountsMatch(amountWithoutVat, vatRate, amount) ||
    !/^[A-Z]{3}$/.test(currency) ||
    !isIsoDate(issueDate) || !isIsoDate(dueDate) || dueDate < issueDate
  ) return null;

  const optional = (key: string, maxLength: number) => {
    const result = text(body, key, maxLength);
    return result && result.length <= maxLength ? result : undefined;
  };

  const ico = optional("counterparty_ico", 20);
  const dic = optional("counterparty_dic", 24);
  const variableSymbol = optional("variable_symbol", 20);
  const notes = optional("notes", 5000);
  const fileUrl = optional("file_url", 500);
  if (
    (typeof body.counterparty_ico === "string" && body.counterparty_ico.trim().length > 20) ||
    (typeof body.counterparty_dic === "string" && body.counterparty_dic.trim().length > 24) ||
    (typeof body.variable_symbol === "string" && body.variable_symbol.trim().length > 20) ||
    (typeof body.notes === "string" && body.notes.trim().length > 5000) ||
    (typeof body.file_url === "string" && body.file_url.trim().length > 500)
  ) return null;

  return {
    invoice_number: invoiceNumber,
    counterparty_name: counterpartyName,
    counterparty_ico: ico,
    counterparty_dic: dic,
    counterparty_email: email,
    variable_symbol: variableSymbol,
    amount_without_vat: roundMoney(amountWithoutVat),
    vat_rate: roundMoney(vatRate),
    amount: grossFromNet(amountWithoutVat, vatRate),
    currency,
    issue_date: issueDate,
    due_date: dueDate,
    notes,
    source: body.source === "ocr" ? "ocr" : "manual",
    file_url: fileUrl,
  };
}
