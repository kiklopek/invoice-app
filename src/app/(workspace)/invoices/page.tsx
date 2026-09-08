import { getCachedRequestIdentity } from "@/lib/auth";
import { loadInvoiceListPageData } from "@/lib/invoice-list-page-data";
import { parseInvoiceListQuery } from "@/lib/invoice-list-query";
import { isDemoMode } from "@/lib/supabase-server";
import { InvoicesClient } from "./invoices-client";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) for (const item of value) params.append(key, item);
  }
  params.set("paged", "1");
  const query = parseInvoiceListQuery(params) ?? { query: "", status: null, currency: null, from: null, to: null, page: 1 };
  const normalized = new URLSearchParams({ paged: "1", page: String(query.page) });
  if (query.query) normalized.set("q", query.query);
  if (query.status) normalized.set("status", query.status);
  if (query.currency) normalized.set("currency", query.currency);
  if (query.from) normalized.set("from", query.from);
  if (query.to) normalized.set("to", query.to);
  const identity = isDemoMode() ? null : await getCachedRequestIdentity();
  const initialData = await loadInvoiceListPageData(identity, query);
  return <InvoicesClient initialData={initialData} initialQuery={query} initialKey={`/api/invoices?${normalized.toString()}`} />;
}
