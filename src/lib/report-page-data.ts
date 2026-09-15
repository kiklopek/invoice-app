import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import type { InvoiceReport, ReportQuery } from "@/lib/report-query";
import { todayInTimeZone } from "@/lib/reminders";
import { canViewFinancialInsights } from "@/lib/role-access";
import { PageDataError } from "@/lib/dashboard-page-data";

export type ReportPageData = InvoiceReport;

export async function loadReportPageData(identity: RequestIdentity | null, query: ReportQuery): Promise<ReportPageData> {
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);
  if (!canViewFinancialInsights(identity.membership.role)) throw new PageDataError("K reportům nemáte přístup.", 403);
  const { data, error } = await identity.service.rpc("invoice_report_summary", {
    target_org: identity.membership.organization_id, actor_user: identity.user.id,
    report_from: query.from, report_to: query.to, date_basis: query.dateBasis,
    currency_filter: query.currency, status_filter: query.status ?? undefined,
    customer_filter: query.customer ?? undefined, as_of_date: todayInTimeZone(),
  });
  if (error || !data) throw new PageDataError("Report se nepodařilo sestavit. Zkontrolujte databázovou migraci.", 500);
  return data as ReportPageData;
}
