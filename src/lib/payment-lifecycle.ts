import type { InvoiceStatus } from "@/types/invoice";

export function isOpenInvoiceStatus(status: InvoiceStatus): status is "pending" | "overdue" {
  return status === "pending" || status === "overdue";
}

export function requiresAtomicPaymentReopen(current: InvoiceStatus, next: InvoiceStatus): boolean {
  return current === "paid" && isOpenInvoiceStatus(next);
}

export function canCancelInvoiceFrom(status: InvoiceStatus): boolean {
  return status === "pending" || status === "overdue";
}
