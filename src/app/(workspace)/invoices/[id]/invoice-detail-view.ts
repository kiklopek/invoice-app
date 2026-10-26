import { minorUnits } from "@/lib/money";
import type { Invoice } from "@/types/invoice";

/** Presentation only. Settlement and permissions remain server-authoritative. */
export function invoiceDetailView(invoice: Invoice) {
  const remaining = Math.max(0, minorUnits(invoice.amount) - minorUnits(invoice.paid_amount)) / 100;
  const open = invoice.status === "pending" || invoice.status === "overdue";
  const partial = open && Number(invoice.paid_amount) > 0;
  const labels = { pending: "Čeká na úhradu", overdue: "Po splatnosti", paid: "Zaplaceno", cancelled: "Stornováno" };
  return {
    open, partial, remaining,
    label: partial ? "Částečně uhrazeno" : labels[invoice.status],
    tone: partial ? "partial" : invoice.status,
    vatAmount: (minorUnits(invoice.amount) - minorUnits(invoice.amount_without_vat)) / 100,
    remindersActive: open && !invoice.reminders_paused,
  };
}
