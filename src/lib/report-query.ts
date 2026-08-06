import { isIsoDate } from "./invoice-validation";
import { calendarDaysBetween } from "./reporting";
import type { Invoice, InvoiceStatus } from "@/types/invoice";

export type ReportDateBasis = "issue_date" | "due_date" | "paid_at";
export type ReportQuery = {
  from: string;
  to: string;
  dateBasis: ReportDateBasis;
  currency: string;
  status: InvoiceStatus | null;
  customer: string | null;
};

export type InvoiceReport = {
  invoice_count: number;
  total: number;
  paid: number;
  overdue: number;
  open: number;
  paid_rate: number;
  counts: Record<InvoiceStatus, number>;
  aging: { label: string; amount: number; count: number }[];
  monthly: { key: string; issued: number; paid: number }[];
  debtors: { name: string; open: number; overdue: number; count: number; reminders: number }[];
  currencies: string[];
  customers: string[];
};

const statuses: InvoiceStatus[] = ["pending", "overdue", "paid", "cancelled"];
const bases: ReportDateBasis[] = ["issue_date", "due_date", "paid_at"];

export function parseReportQuery(params: URLSearchParams): ReportQuery | null {
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const dateBasis = (params.get("date_basis") ?? "issue_date") as ReportDateBasis;
  const currency = params.get("currency") ?? "CZK";
  const rawStatus = params.get("status") || null;
  const customer = (params.get("customer") || "").trim() || null;
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return null;
  if (!bases.includes(dateBasis) || !/^[A-Z]{3}$/.test(currency)) return null;
  if (rawStatus && !statuses.includes(rawStatus as InvoiceStatus)) return null;
  if (customer && (customer.length > 200 || /[\u0000-\u001f\u007f]/.test(customer))) return null;
  return { from, to, dateBasis, currency, status: rawStatus as InvoiceStatus | null, customer };
}

export function invoiceDateForReport(invoice: Invoice, basis: ReportDateBasis): string | null {
  return basis === "paid_at" ? invoice.paid_at?.slice(0, 10) ?? null : invoice[basis];
}

export function buildInvoiceReport(invoices: Invoice[], currency: string, today: string, allInvoices = invoices): InvoiceReport {
  const counts = { pending: 0, overdue: 0, paid: 0, cancelled: 0 } as Record<InvoiceStatus, number>;
  for (const invoice of invoices) counts[invoice.status]++;
  const openInvoices = invoices.filter(invoice => invoice.status === "pending" || invoice.status === "overdue");
  const sum = (items: Invoice[]) => items.reduce((total, invoice) => total + Number(invoice.amount), 0);
  const outstanding = (invoice: Invoice) => Number(invoice.amount) - Number(invoice.paid_amount);
  const total = sum(invoices);
  const paid = invoices.filter(invoice => invoice.status !== "cancelled").reduce((total, invoice) => total + Number(invoice.paid_amount), 0);
  const overdue = invoices.filter(invoice => invoice.status === "overdue").reduce((totalValue, invoice) => totalValue + outstanding(invoice), 0);
  const open = openInvoices.reduce((totalValue, invoice) => totalValue + outstanding(invoice), 0);
  const billed = sum(invoices.filter(invoice => invoice.status !== "cancelled"));
  const aging = [{ label: "Před splatností", amount: 0, count: 0 }, { label: "1–7 dní", amount: 0, count: 0 }, { label: "8–14 dní", amount: 0, count: 0 }, { label: "15–30 dní", amount: 0, count: 0 }, { label: "Více než 30 dní", amount: 0, count: 0 }];
  for (const invoice of openInvoices) {
    const days = calendarDaysBetween(invoice.due_date, today);
    const index = days <= 0 ? 0 : days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 3 : 4;
    aging[index].amount += outstanding(invoice); aging[index].count++;
  }
  const monthlyMap = new Map<string, { key: string; issued: number; paid: number }>();
  for (const invoice of invoices) {
    const key = invoice.issue_date.slice(0, 7); const month = monthlyMap.get(key) ?? { key, issued: 0, paid: 0 };
    month.issued += Number(invoice.amount); month.paid += Number(invoice.paid_amount); monthlyMap.set(key, month);
  }
  const debtorMap = new Map<string, { name: string; open: number; overdue: number; count: number; reminders: number }>();
  for (const invoice of openInvoices) {
    const row = debtorMap.get(invoice.counterparty_name) ?? { name: invoice.counterparty_name, open: 0, overdue: 0, count: 0, reminders: 0 };
    row.open += outstanding(invoice); if (invoice.status === "overdue") row.overdue += outstanding(invoice); row.count++; row.reminders += invoice.reminders_sent; debtorMap.set(row.name, row);
  }
  return {
    invoice_count: invoices.length, total, paid, overdue, open, paid_rate: billed ? Math.round(paid / billed * 100) : 0, counts, aging,
    monthly: [...monthlyMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
    debtors: [...debtorMap.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name, "cs")),
    currencies: [...new Set(allInvoices.map(invoice => invoice.currency))].sort(),
    customers: [...new Set(allInvoices.map(invoice => invoice.counterparty_name))].sort((a, b) => a.localeCompare(b, "cs")),
  };
}
