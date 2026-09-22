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
  counts: Record<InvoiceStatus, number> & { cancelled_amount: number };
  aging: { label: string; amount: number; count: number }[];
  monthly: { key: string; issued: number; paid: number; count: number }[];
  debtors: { name: string; open: number; overdue: number; count: number; reminders: number }[];
  currencies: string[];
  customers: string[];
  vat_breakdown: { vat_rate: number; base: number; tax: number; gross: number; count: number }[];
  dso: { avg_days: number; paid_invoice_count: number };
  dso_monthly: { key: string; avg_days: number; count: number }[];
  customer_concentration: { name: string; revenue: number; count: number }[];
  yoy_monthly: { month: string; current_year: number; prior_year: number }[];
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
  const counts = { pending: 0, overdue: 0, paid: 0, cancelled: 0, cancelled_amount: 0 } as Record<InvoiceStatus, number> & { cancelled_amount: number };
  for (const invoice of invoices) {
    counts[invoice.status]++;
    if (invoice.status === "cancelled") counts.cancelled_amount += Number(invoice.amount);
  }
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
  const monthlyMap = new Map<string, { key: string; issued: number; paid: number; count: number }>();
  for (const invoice of invoices) {
    const key = invoice.issue_date.slice(0, 7); const month = monthlyMap.get(key) ?? { key, issued: 0, paid: 0, count: 0 };
    month.issued += Number(invoice.amount); month.paid += Number(invoice.paid_amount); month.count++; monthlyMap.set(key, month);
  }
  const debtorMap = new Map<string, { name: string; open: number; overdue: number; count: number; reminders: number }>();
  for (const invoice of openInvoices) {
    const row = debtorMap.get(invoice.counterparty_name) ?? { name: invoice.counterparty_name, open: 0, overdue: 0, count: 0, reminders: 0 };
    row.open += outstanding(invoice); if (invoice.status === "overdue") row.overdue += outstanding(invoice); row.count++; row.reminders += invoice.reminders_sent; debtorMap.set(row.name, row);
  }
  const vatMap = new Map<number, { vat_rate: number; base: number; tax: number; gross: number; count: number }>();
  for (const invoice of invoices) {
    const rate = Number(invoice.vat_rate);
    const row = vatMap.get(rate) ?? { vat_rate: rate, base: 0, tax: 0, gross: 0, count: 0 };
    row.base += Number(invoice.amount_without_vat); row.tax += Number(invoice.amount) - Number(invoice.amount_without_vat);
    row.gross += Number(invoice.amount); row.count++; vatMap.set(rate, row);
  }
  // DSO only counts invoices actually settled in full (status "paid"), not
  // partial payments -- paid_at is only ever set once an invoice reaches
  // full payoff elsewhere in this codebase, so this is the standard "days
  // to full settlement" reading, mirroring the SQL function's paid_settled CTE.
  const paidSettled = invoices
    .filter(invoice => invoice.status === "paid" && invoice.paid_at)
    .map(invoice => ({ issue_date: invoice.issue_date, paid_date: invoice.paid_at!.slice(0, 10), days: calendarDaysBetween(invoice.issue_date, invoice.paid_at!.slice(0, 10)) }));
  const dsoMonthlyMap = new Map<string, { key: string; totalDays: number; count: number }>();
  for (const settled of paidSettled) {
    const key = settled.paid_date.slice(0, 7);
    const row = dsoMonthlyMap.get(key) ?? { key, totalDays: 0, count: 0 };
    row.totalDays += settled.days; row.count++; dsoMonthlyMap.set(key, row);
  }
  const round1 = (value: number) => Math.round(value * 10) / 10;
  const customerMap = new Map<string, { name: string; revenue: number; count: number }>();
  for (const invoice of invoices) {
    const row = customerMap.get(invoice.counterparty_name) ?? { name: invoice.counterparty_name, revenue: 0, count: 0 };
    row.revenue += Number(invoice.amount); row.count++; customerMap.set(invoice.counterparty_name, row);
  }
  const rankedCustomers = [...customerMap.values()].sort((a, b) => b.revenue - a.revenue);
  const topCustomers = rankedCustomers.slice(0, 10);
  const restCustomers = rankedCustomers.slice(10);
  const customerConcentration = restCustomers.length
    ? [...topCustomers, { name: "Ostatní", revenue: restCustomers.reduce((total, row) => total + row.revenue, 0), count: restCustomers.reduce((total, row) => total + row.count, 0) }]
    : topCustomers;
  // yoy_monthly's TS mirror approximates the SQL version's explicit
  // report_from/report_to window with the min/max issue_date actually
  // present in `invoices` -- buildInvoiceReport has no from/to parameters
  // (its only real caller is this file's own test), so widening its
  // signature just for this one field isn't worth it. Good enough for a
  // unit-tested shape/math check; the real tie-out is the SQL spot-check
  // documented in the report upgrade plan, not this mirror.
  const issueDates = invoices.map(invoice => invoice.issue_date).sort();
  const yoyMonthly: InvoiceReport["yoy_monthly"] = [];
  if (issueDates.length) {
    const shiftYear = (date: string, delta: number) => { const [y, m, d] = date.split("-").map(Number); return `${y + delta}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
    const priorFrom = shiftYear(issueDates[0], -1); const priorTo = shiftYear(issueDates[issueDates.length - 1], -1);
    const currentByMonth = new Map<string, number>();
    for (const invoice of invoices) { const key = invoice.issue_date.slice(5, 7); currentByMonth.set(key, (currentByMonth.get(key) ?? 0) + Number(invoice.amount)); }
    const priorByMonth = new Map<string, number>();
    for (const invoice of allInvoices) { if (invoice.issue_date >= priorFrom && invoice.issue_date <= priorTo) { const key = invoice.issue_date.slice(5, 7); priorByMonth.set(key, (priorByMonth.get(key) ?? 0) + Number(invoice.amount)); } }
    const months = new Set([...currentByMonth.keys(), ...priorByMonth.keys()]);
    for (const month of [...months].sort()) yoyMonthly.push({ month, current_year: currentByMonth.get(month) ?? 0, prior_year: priorByMonth.get(month) ?? 0 });
  }
  return {
    invoice_count: invoices.length, total, paid, overdue, open, paid_rate: billed ? Math.round(paid / billed * 100) : 0, counts, aging,
    monthly: [...monthlyMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
    debtors: [...debtorMap.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name, "cs")),
    currencies: [...new Set(allInvoices.map(invoice => invoice.currency))].sort(),
    customers: [...new Set(allInvoices.map(invoice => invoice.counterparty_name))].sort((a, b) => a.localeCompare(b, "cs")),
    vat_breakdown: [...vatMap.values()].sort((a, b) => a.vat_rate - b.vat_rate),
    dso: {
      avg_days: paidSettled.length ? round1(paidSettled.reduce((totalValue, row) => totalValue + row.days, 0) / paidSettled.length) : 0,
      paid_invoice_count: paidSettled.length,
    },
    dso_monthly: [...dsoMonthlyMap.values()].map(row => ({ key: row.key, avg_days: round1(row.totalDays / row.count), count: row.count })).sort((a, b) => a.key.localeCompare(b.key)),
    customer_concentration: customerConcentration,
    yoy_monthly: yoyMonthly,
  };
}
