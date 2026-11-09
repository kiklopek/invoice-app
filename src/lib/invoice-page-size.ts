export const INVOICE_PAGE_SIZES = [10, 25, 50, 100] as const;
export type InvoicePageSize = (typeof INVOICE_PAGE_SIZES)[number];
/** "auto" = Automaticky: as many rows as fit the window (desktop only). */
export type InvoicePageSizeChoice = InvoicePageSize | "auto";
export const DEFAULT_INVOICE_PAGE_SIZE: InvoicePageSize = 25;
export const INVOICE_PAGE_SIZE_COOKIE = "splatno-invoices-page-size";
export const MIN_AUTO_INVOICE_ROWS = 5;
export const MAX_AUTO_INVOICE_ROWS = 100;

export function parseInvoicePageSize(value: unknown): InvoicePageSize | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  return INVOICE_PAGE_SIZES.find(size => String(size) === String(value)) ?? null;
}

export function parseInvoicePageSizeChoice(value: unknown): InvoicePageSizeChoice | null {
  return value === "auto" ? "auto" : parseInvoicePageSize(value);
}

/** Size of one request: a menu choice or the exact count Automaticky asked for. */
export function parseInvoiceRequestPageSize(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  if (!/^[1-9]\d{0,2}$/.test(text)) return null;
  const size = Number(text);
  return size >= MIN_AUTO_INVOICE_ROWS && size <= MAX_AUTO_INVOICE_ROWS ? size : null;
}

export function saveInvoicePageSize(choice: InvoicePageSizeChoice) {
  document.cookie = `${INVOICE_PAGE_SIZE_COOKIE}=${choice}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

/** Whole rows that fit `room` px, and the leftover spread over them (max 18 px a row). */
export function fitInvoiceRows(room: number, rowHeight: number) {
  if (!(room > 0) || !(rowHeight > 0)) return { rows: MIN_AUTO_INVOICE_ROWS, extra: 0 };
  const fitting = Math.floor(room / rowHeight);
  const rows = Math.min(MAX_AUTO_INVOICE_ROWS, Math.max(MIN_AUTO_INVOICE_ROWS, fitting));
  if (rows !== fitting) return { rows, extra: 0 };
  return { rows, extra: Math.min(18, Math.floor((room - rows * rowHeight) / rows)) };
}

/** Page that still starts with the invoice that was first before a size change. */
export function invoicePageKeepingFirstRow(page: number, oldSize: number, newSize: number) {
  return Math.floor(((page - 1) * oldSize) / newSize) + 1;
}
