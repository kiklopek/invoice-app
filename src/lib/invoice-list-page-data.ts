import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import { canManageInvoices } from "@/lib/role-access";
import type { InvoiceListQuery } from "@/lib/invoice-list-query";
import type { Invoice } from "@/types/invoice";
import { PageDataError } from "@/lib/dashboard-page-data";

import { invoiceListRpcParams } from "./invoice-list-rpc-params";
import {
  DEFAULT_INVOICE_PAGE_SIZE,
  parseInvoicePageSize,
} from "./invoice-page-size";

export const INVOICE_LIST_PAGE_SIZE = DEFAULT_INVOICE_PAGE_SIZE;

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

  const pageSize =
    parseInvoicePageSize(query.pageSize) ?? INVOICE_LIST_PAGE_SIZE;
  const { data, error } = await identity.service.rpc(
    "list_invoices_page_filtered",
    invoiceListRpcParams(
      identity.membership.organization_id,
      identity.user.id,
      query,
      query.page,
      pageSize,
    ),
  );
  const result = data as Omit<
    InvoiceListPageData,
    "can_manage" | "page" | "page_size" | "total_pages"
  > | null;
  if (error || !result)
    throw new PageDataError(
      "Faktury se nepodařilo načíst. Zkuste to prosím znovu za chvíli.",
      500,
    );
  return {
    ...result,
    can_manage: canManageInvoices(identity.membership.role),
    page: query.page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(result.total / pageSize)),
  };
}
