import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import { canManageInvoices } from "@/lib/role-access";
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

export async function loadInvoiceListPageData(
  identity: RequestIdentity | null,
  query: InvoiceListQuery,
): Promise<InvoiceListPageData> {
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);

  const { data, error } = await identity.service.rpc(
    "list_invoices_page_filtered",
    {
      target_org: identity.membership.organization_id,
      actor_user: identity.user.id,
      search_query: query.query || undefined,
      status_filter: query.status ?? undefined,
      currency_filter: query.currency ?? undefined,
      issue_from: query.from ?? undefined,
      issue_to: query.to ?? undefined,
      due_from: query.dueFrom ?? undefined,
      due_to: query.dueTo ?? undefined,
      amount_min: query.amountMin ?? undefined,
      amount_max: query.amountMax ?? undefined,
      payment_state: query.paymentState ?? undefined,
      bank_match_state: query.bankMatch ?? undefined,
      page_number: query.page,
      page_size: INVOICE_LIST_PAGE_SIZE,
    },
  );
  const result = data as Omit<
    InvoiceListPageData,
    "can_manage" | "page" | "page_size" | "total_pages"
  > | null;
  if (error || !result)
    throw new PageDataError(
      "Faktury se nepodařilo načíst. Zkontrolujte databázovou migraci.",
      500,
    );
  return {
    ...result,
    can_manage: canManageInvoices(identity.membership.role),
    page: query.page,
    page_size: INVOICE_LIST_PAGE_SIZE,
    total_pages: Math.max(1, Math.ceil(result.total / INVOICE_LIST_PAGE_SIZE)),
  };
}
