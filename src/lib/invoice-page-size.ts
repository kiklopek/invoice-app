export const INVOICE_PAGE_SIZES = [10, 25, 50, 100] as const;
export type InvoicePageSize = (typeof INVOICE_PAGE_SIZES)[number];
export const DEFAULT_INVOICE_PAGE_SIZE: InvoicePageSize = 25;
export const INVOICE_PAGE_SIZE_COOKIE = "splatno-invoices-page-size";

export function parseInvoicePageSize(value: unknown): InvoicePageSize | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  return INVOICE_PAGE_SIZES.find(size => String(size) === String(value)) ?? null;
}

export function saveInvoicePageSize(size: InvoicePageSize) {
  document.cookie = `${INVOICE_PAGE_SIZE_COOKIE}=${size}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}
