import "server-only";
import type { Invoice } from "@/types/invoice";
import { issuedDocument, type CreationDraft } from "./invoice-creation";
import { invoiceApiBody } from "./public-api-input";

export const PUBLIC_INVOICE_FIELDS = "id,invoice_number,variable_symbol,amount,amount_without_vat,paid_amount,currency,status,issue_date,due_date,paid_at,created_at,updated_at,counterparty_name,counterparty_email,counterparty_ico,counterparty_dic,reminders_paused,money_evidence";
export function invoiceApiResponse(invoice: Invoice) {
  const snapshot = issuedDocument(invoice);
  return {
    id: invoice.id, invoice_number: invoice.invoice_number, variable_symbol: invoice.variable_symbol,
    amount: Number(invoice.amount).toFixed(2), amount_without_vat: Number(invoice.amount_without_vat).toFixed(2), paid_amount: Number(invoice.paid_amount).toFixed(2),
    remaining_amount: Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount)).toFixed(2), currency: invoice.currency, status: invoice.status,
    issue_date: invoice.issue_date, due_date: invoice.due_date, paid_at: invoice.paid_at, created_at: invoice.created_at, updated_at: invoice.updated_at, reminders_paused: invoice.reminders_paused,
    customer: { name: invoice.counterparty_name, email: invoice.counterparty_email, ico: invoice.counterparty_ico, dic: invoice.counterparty_dic, address: snapshot?.customer.address ?? null },
    ...(snapshot ? { tax_date: snapshot.tax_date, payment_method: snapshot.payment_method, public_note: snapshot.public_note,
      items: snapshot.totals.lines.map(line => ({ description: line.description, quantity: line.quantity, unit: line.unit, unit_price: line.unit_price, price_mode: line.price_mode ?? "net", vat_rate: line.vat_rate, net: line.net.toFixed(2), tax: line.tax.toFixed(2), gross: line.gross.toFixed(2) })),
      vat_breakdown: snapshot.totals.breakdown.map(row => ({ rate: row.rate, net: row.net.toFixed(2), tax: row.tax.toFixed(2), gross: row.gross.toFixed(2) })) } : {}),
  };
}
export function apiCreationDraft(body: ReturnType<typeof invoiceApiBody>, operationId: string): CreationDraft {
  return {
    version: 1, request_id: operationId, invoice_number: "FV-AUTO", variable_symbol: body.variable_symbol,
    issue_date: body.issue_date, tax_date: body.tax_date, due_date: body.due_date, currency: body.currency,
    payment_method: body.payment_method, payment_account: "", customer_id: "", customer: body.customer,
    items: body.items.map((line, index) => ({ id: `api-${index}`, description: line.description, quantity: line.quantity, unit: line.unit, unit_price: line.unit_price_gross, price_mode: "gross", discount: "0", vat_rate: line.vat_rate })),
    public_note: body.public_note, internal_note: body.internal_note, attachment: null,
  };
}
