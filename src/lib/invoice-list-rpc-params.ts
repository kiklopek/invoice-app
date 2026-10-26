import type { InvoiceListQuery } from "./invoice-list-query";

export function invoiceListRpcParams(
  organizationId: string,
  userId: string,
  query: InvoiceListQuery,
  page: number,
  size: number,
) {
  return {
    target_org: organizationId,
    actor_user: userId,
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
    page_number: page,
    page_size: size,
  };
}
