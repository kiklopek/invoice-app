import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import { canManageInvoices } from "@/lib/role-access";
import { demoInvoices } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/supabase-server";
import type { InvoiceListQuery } from "@/lib/invoice-list-query";
import type { Invoice } from "@/types/invoice";
import { PageDataError } from "@/lib/dashboard-page-data";

export const INVOICE_LIST_PAGE_SIZE = 25;

export type InvoiceListPageData = {
  invoices: Invoice[];
  total: number;
  open_totals: Record<string, number>;
  currencies: string[];
  active_count: number;
  can_manage: boolean;
  page: number;
  page_size: number;
  total_pages: number;
};

function loadDemoInvoicePage(query: InvoiceListQuery): InvoiceListPageData {
  const needle = query.query.toLocaleLowerCase("cs");
  const filtered = demoInvoices.filter(invoice =>
    (!query.status || (query.status === "closed" ? invoice.status === "paid" || invoice.status === "cancelled" : invoice.status === query.status))
    && (!query.currency || invoice.currency === query.currency)
    && (!query.from || invoice.issue_date >= query.from)
    && (!query.to || invoice.issue_date <= query.to)
    && (!needle || [invoice.invoice_number, invoice.counterparty_name, invoice.counterparty_email, invoice.variable_symbol]
      .some(value => value?.toLocaleLowerCase("cs").includes(needle)))
  ).sort((a, b) => {
    const priority: Record<Invoice["status"], number> = { overdue: 0, pending: 1, paid: 2, cancelled: 3 };
    const rank = priority[a.status] - priority[b.status];
    if (rank) return rank;
    if (a.status === "overdue" || a.status === "pending") return a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id);
    if (a.status === "paid" && b.status === "paid") return (b.paid_at ?? b.updated_at).localeCompare(a.paid_at ?? a.updated_at) || a.id.localeCompare(b.id);
    return b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id);
  });
  const openTotals: Record<string, number> = {};
  for (const invoice of filtered) if (invoice.status === "pending" || invoice.status === "overdue") {
    openTotals[invoice.currency] = (openTotals[invoice.currency] ?? 0) + Number(invoice.amount) - Number(invoice.paid_amount);
  }
  const offset = (query.page - 1) * INVOICE_LIST_PAGE_SIZE;
  return {
    invoices: filtered.slice(offset, offset + INVOICE_LIST_PAGE_SIZE),
    total: filtered.length,
    open_totals: openTotals,
    currencies: [...new Set(demoInvoices.map(invoice => invoice.currency))].sort(),
    active_count: demoInvoices.filter(invoice => invoice.status === "pending" || invoice.status === "overdue").length,
    can_manage: true,
    page: query.page,
    page_size: INVOICE_LIST_PAGE_SIZE,
    total_pages: Math.max(1, Math.ceil(filtered.length / INVOICE_LIST_PAGE_SIZE)),
  };
}

export async function loadInvoiceListPageData(identity: RequestIdentity | null, query: InvoiceListQuery): Promise<InvoiceListPageData> {
  if (isDemoMode()) return loadDemoInvoicePage(query);
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);

  const { data, error } = await identity.service.rpc("list_invoices_page", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
    search_query: query.query || undefined,
    status_filter: query.status ?? undefined,
    currency_filter: query.currency ?? undefined,
    issue_from: query.from ?? undefined,
    issue_to: query.to ?? undefined,
    page_number: query.page,
    page_size: INVOICE_LIST_PAGE_SIZE,
  });
  const result = data as Omit<InvoiceListPageData, "can_manage" | "page" | "page_size" | "total_pages"> | null;
  if (error || !result) throw new PageDataError("Faktury se nepodařilo načíst. Zkontrolujte databázovou migraci.", 500);
  return {
    ...result,
    can_manage: canManageInvoices(identity.membership.role),
    page: query.page,
    page_size: INVOICE_LIST_PAGE_SIZE,
    total_pages: Math.max(1, Math.ceil(result.total / INVOICE_LIST_PAGE_SIZE)),
  };
}
