import type { Invoice } from "@/types/invoice";
import { calendarDaysBetween } from "@/lib/reporting";
export type InvoiceSort =
  | "default"
  | "invoice_number"
  | "counterparty_name"
  | "amount"
  | "issue_date"
  | "due_date"
  | "status"
  | "paid_amount";
export type InvoiceSortOrder = {
  field: InvoiceSort;
  direction: "asc" | "desc";
};
export const invoiceSortOptions: Array<InvoiceSortOrder & { label: string }> = [
  { field: "default", direction: "asc", label: "Výchozí pořadí" },
  { field: "invoice_number", direction: "asc", label: "Číslo faktury ↑" },
  { field: "invoice_number", direction: "desc", label: "Číslo faktury ↓" },
  { field: "counterparty_name", direction: "asc", label: "Odběratel" },
  { field: "amount", direction: "asc", label: "Částka od nejnižší" },
  { field: "amount", direction: "desc", label: "Částka od nejvyšší" },
  { field: "issue_date", direction: "desc", label: "Nejnovější faktury" },
  { field: "issue_date", direction: "asc", label: "Nejstarší faktury" },
  { field: "due_date", direction: "asc", label: "Nejbližší splatnost" },
  { field: "due_date", direction: "desc", label: "Nejzazší splatnost" },
  { field: "paid_amount", direction: "asc", label: "Uhrazeno ↑" },
  { field: "paid_amount", direction: "desc", label: "Uhrazeno ↓" },
];
export const invoiceStatusLabels = {
  pending: "Čeká na úhradu",
  overdue: "Po splatnosti",
  paid: "Zaplaceno",
  cancelled: "Stornováno",
};
export const invoiceMoney = (
  value: number,
  currency: string,
  decimals = true,
) =>
  new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
export const invoiceDate = (value: string) =>
  new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague" }).format(
    new Date(`${value.slice(0, 10)}T12:00:00Z`),
  );
export function invoicePaidPercentage(amount: number, paid: number) {
  return Number.isFinite(amount) && Number.isFinite(paid) && amount > 0
    ? Math.min(100, Math.max(0, (paid / amount) * 100))
    : 0;
}
export function invoiceDueContext(
  invoice: Pick<Invoice, "due_date" | "status">,
  today: string,
) {
  if (invoice.status === "paid") return "Zaplaceno";
  if (invoice.status === "cancelled") return "Stornováno";
  const days = calendarDaysBetween(today, invoice.due_date);
  if (!days) return "Splatnost dnes";
  const count = Math.abs(days),
    unit = count === 1 ? "den" : count < 5 ? "dny" : "dní";
  return days < 0 ? `Po splatnosti ${count} ${unit}` : `Za ${count} ${unit}`;
}
export function sortInvoicePage(
  invoices: Invoice[],
  sort: InvoiceSort,
  direction: "asc" | "desc",
) {
  if (sort === "default") return invoices;
  const collator = new Intl.Collator("cs", {
    numeric: true,
    sensitivity: "base",
  });
  return [...invoices].sort((a, b) => {
    const result =
      sort === "amount" || sort === "paid_amount"
        ? Number(a[sort]) - Number(b[sort])
        : collator.compare(
            sort === "status" ? invoiceStatusLabels[a.status] : String(a[sort]),
            sort === "status" ? invoiceStatusLabels[b.status] : String(b[sort]),
          );
    return (direction === "asc" ? result : -result) || a.id.localeCompare(b.id);
  });
}
export function invoicePageNumbers(page: number, total: number) {
  return [
    ...new Set([
      1,
      total,
      ...[page - 1, page, page + 1].filter(
        (value) => value >= 1 && value <= total,
      ),
    ]),
  ].sort((a, b) => a - b);
}
