import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import type { PaymentReconciliationQuery, PaymentReconciliationSummary } from "@/lib/payment-reconciliation-query";
import { PageDataError } from "@/lib/dashboard-page-data";

// Only ever called from loadReportPageData (report-page-data.ts), which has
// already checked identity/role -- this is a thin RPC wrapper, not its own
// independently-gated endpoint.
export async function loadPaymentReconciliationSummary(
  identity: RequestIdentity,
  query: PaymentReconciliationQuery,
): Promise<PaymentReconciliationSummary> {
  const { data, error } = await identity.service.rpc("payment_reconciliation_summary", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
    report_from: query.from,
    report_to: query.to,
  });
  if (error || !data) throw new PageDataError("Přehled párování plateb se nepodařilo sestavit. Zkuste to prosím znovu za chvíli.", 500);
  return data as PaymentReconciliationSummary;
}
