import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import type { InvoiceReport, ReportQuery } from "@/lib/report-query";
import type { PaymentReconciliationSummary } from "@/lib/payment-reconciliation-query";
import { todayInTimeZone } from "@/lib/reminders";
import { canViewFinancialInsights } from "@/lib/role-access";
import { PageDataError } from "@/lib/dashboard-page-data";
import { loadPaymentReconciliationSummary } from "@/lib/payment-reconciliation-page-data";

export type ReportPageData = InvoiceReport & { payment_reconciliation: PaymentReconciliationSummary };

export async function loadReportPageData(identity: RequestIdentity | null, query: ReportQuery): Promise<ReportPageData> {
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);
  if (!canViewFinancialInsights(identity.membership.role)) throw new PageDataError("K reportům nemáte přístup.", 403);
  // Both queried in parallel and merged into one payload -- the reports page
  // does a single fetch, no extra loading state for the reconciliation card.
  const [{ data, error }, paymentReconciliation] = await Promise.all([
    identity.service.rpc("invoice_report_summary", {
      target_org: identity.membership.organization_id, actor_user: identity.user.id,
      report_from: query.from, report_to: query.to, date_basis: query.dateBasis,
      currency_filter: query.currency, status_filter: query.status ?? undefined,
      customer_filter: query.customer ?? undefined, as_of_date: todayInTimeZone(),
    }),
    loadPaymentReconciliationSummary(identity, { from: query.from, to: query.to }),
  ]);
  if (error || !data) throw new PageDataError("Report se nepodařilo sestavit. Zkuste to prosím znovu za chvíli.", 500);
  return { ...(data as InvoiceReport), payment_reconciliation: paymentReconciliation };
}
