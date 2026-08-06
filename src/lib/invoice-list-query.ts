import { isIsoDate } from "./invoice-validation";
import type { InvoiceStatus } from "@/types/invoice";

export type InvoiceListQuery = {
  query: string;
  status: InvoiceStatus | null;
  currency: string | null;
  from: string | null;
  to: string | null;
  page: number;
};

const statuses: InvoiceStatus[] = ["pending", "overdue", "paid", "cancelled"];

export function parseInvoiceListQuery(params: URLSearchParams): InvoiceListQuery | null {
  const query = (params.get("q") ?? "").trim();
  const rawStatus = params.get("status") || null;
  const rawCurrency = params.get("currency") || null;
  const from = params.get("from") || null;
  const to = params.get("to") || null;
  const rawPage = params.get("page") ?? "1";
  const page = Number(rawPage);

  if (query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) return null;
  if (rawStatus && !statuses.includes(rawStatus as InvoiceStatus)) return null;
  if (rawCurrency && !/^[A-Z]{3}$/.test(rawCurrency)) return null;
  if (from && !isIsoDate(from)) return null;
  if (to && !isIsoDate(to)) return null;
  if (from && to && from > to) return null;
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000) return null;

  return { query, status: rawStatus as InvoiceStatus | null, currency: rawCurrency, from, to, page };
}
