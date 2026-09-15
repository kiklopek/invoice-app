import { isIsoDate } from "./invoice-validation";
import type { InvoiceStatus } from "@/types/invoice";

export type InvoiceListQuery = {
  query: string;
  status: InvoiceStatus | "closed" | null;
  currency: string | null;
  from: string | null;
  to: string | null;
  dueFrom: string | null;
  dueTo: string | null;
  amountMin: number | null;
  amountMax: number | null;
  paymentState: "unpaid" | "partial" | "paid" | null;
  bankMatch: "matched" | "unmatched" | null;
  page: number;
};

const statuses: Array<InvoiceStatus | "closed"> = [
  "pending",
  "overdue",
  "paid",
  "cancelled",
  "closed",
];

export function parseInvoiceListQuery(
  params: URLSearchParams,
): InvoiceListQuery | null {
  const query = (params.get("q") ?? "").trim();
  const rawStatus = params.get("status") || null;
  const rawCurrency = params.get("currency") || null;
  const from = params.get("from") || null;
  const to = params.get("to") || null;
  const dueFrom = params.get("due_from") || null;
  const dueTo = params.get("due_to") || null;
  const rawAmountMin = params.get("amount_min");
  const rawAmountMax = params.get("amount_max");
  const amountMin = rawAmountMin ? Number(rawAmountMin) : null;
  const amountMax = rawAmountMax ? Number(rawAmountMax) : null;
  const paymentState = params.get(
    "payment",
  ) as InvoiceListQuery["paymentState"];
  const bankMatch = params.get("bank_match") as InvoiceListQuery["bankMatch"];
  const rawPage = params.get("page") ?? "1";
  const page = Number(rawPage);

  if (query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) return null;
  if (rawStatus && !statuses.includes(rawStatus as InvoiceStatus | "closed"))
    return null;
  if (rawCurrency && !/^[A-Z]{3}$/.test(rawCurrency)) return null;
  if (from && !isIsoDate(from)) return null;
  if (to && !isIsoDate(to)) return null;
  if (from && to && from > to) return null;
  if (
    (dueFrom && !isIsoDate(dueFrom)) ||
    (dueTo && !isIsoDate(dueTo)) ||
    (dueFrom && dueTo && dueFrom > dueTo)
  )
    return null;
  if (
    (amountMin !== null && (!Number.isFinite(amountMin) || amountMin < 0)) ||
    (amountMax !== null && (!Number.isFinite(amountMax) || amountMax < 0)) ||
    (amountMin !== null && amountMax !== null && amountMin > amountMax)
  )
    return null;
  if (
    (paymentState && !["unpaid", "partial", "paid"].includes(paymentState)) ||
    (bankMatch && !["matched", "unmatched"].includes(bankMatch))
  )
    return null;
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000) return null;

  return {
    query,
    status: rawStatus as InvoiceStatus | "closed" | null,
    currency: rawCurrency,
    from,
    to,
    dueFrom,
    dueTo,
    amountMin,
    amountMax,
    paymentState: paymentState || null,
    bankMatch: bankMatch || null,
    page,
  };
}
