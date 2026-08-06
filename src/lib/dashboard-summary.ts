import type { Invoice, InvoiceStatus } from "@/types/invoice";

export type DashboardInvoice = Pick<Invoice,
  "id" | "invoice_number" | "variable_symbol" | "counterparty_name" | "counterparty_email" |
  "amount" | "paid_amount" | "currency" | "due_date" | "status" | "reminders_sent" | "created_at"
>;

export type DashboardUpcoming = Pick<Invoice,
  "id" | "invoice_number" | "counterparty_name" | "amount" | "paid_amount" | "currency" | "status" | "next_reminder_at"
>;

export type DashboardData = {
  open_totals: Record<string, number>;
  overdue_totals: Record<string, number>;
  paid_totals: Record<string, number>;
  active_count: number;
  overdue_count: number;
  reminders_sent: number;
  recent: DashboardInvoice[];
  upcoming: DashboardUpcoming[];
};

export const emptyDashboardData: DashboardData = {
  open_totals: {}, overdue_totals: {}, paid_totals: {}, active_count: 0,
  overdue_count: 0, reminders_sent: 0, recent: [], upcoming: [],
};

const addAmount = (totals: Record<string, number>, invoice: Invoice, value: number) => {
  totals[invoice.currency] = (totals[invoice.currency] ?? 0) + value;
};

export function buildDashboardSummary(invoices: Invoice[]): DashboardData {
  const openTotals: Record<string, number> = {};
  const overdueTotals: Record<string, number> = {};
  const paidTotals: Record<string, number> = {};
  let activeCount = 0;
  let overdueCount = 0;
  let remindersSent = 0;

  for (const invoice of invoices) {
    remindersSent += invoice.reminders_sent;
    if (invoice.status === "pending" || invoice.status === "overdue") {
      activeCount++;
      addAmount(openTotals, invoice, Number(invoice.amount) - Number(invoice.paid_amount));
    }
    if (invoice.status === "overdue") {
      overdueCount++;
      addAmount(overdueTotals, invoice, Number(invoice.amount) - Number(invoice.paid_amount));
    }
    if (invoice.status !== "cancelled" && Number(invoice.paid_amount) > 0) addAmount(paidTotals, invoice, Number(invoice.paid_amount));
  }

  const recent = [...invoices]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    .slice(0, 5)
    .map(({ id, invoice_number, variable_symbol, counterparty_name, counterparty_email, amount, paid_amount, currency, due_date, status, reminders_sent, created_at }) =>
      ({ id, invoice_number, variable_symbol, counterparty_name, counterparty_email, amount, paid_amount, currency, due_date, status, reminders_sent, created_at }));
  const upcoming = invoices
    .filter(invoice => invoice.next_reminder_at && (["pending", "overdue"] as InvoiceStatus[]).includes(invoice.status))
    .sort((a, b) => (a.next_reminder_at ?? "").localeCompare(b.next_reminder_at ?? "") || a.id.localeCompare(b.id))
    .slice(0, 4)
    .map(({ id, invoice_number, counterparty_name, amount, paid_amount, currency, status, next_reminder_at }) =>
      ({ id, invoice_number, counterparty_name, amount, paid_amount, currency, status, next_reminder_at }));

  return { open_totals: openTotals, overdue_totals: overdueTotals, paid_totals: paidTotals,
    active_count: activeCount, overdue_count: overdueCount, reminders_sent: remindersSent, recent, upcoming };
}
