import "server-only";
import type { RequestIdentity } from "./auth";
import { canViewFinancialInsights } from "./role-access";
import type { ReportQuery } from "./report-query";
import type { FinancialReportSnapshot } from "./financial-report";
import { PageDataError } from "./dashboard-page-data";
import { logError } from "./structured-log";
export async function loadFinancialReportSnapshot(
  identity: RequestIdentity | null,
  query: ReportQuery,
): Promise<FinancialReportSnapshot> {
  if (!identity) throw new PageDataError("Nejste přihlášeni.", 401);
  if (!canViewFinancialInsights(identity.membership.role))
    throw new PageDataError("K reportům nemáte přístup.", 403);
  const { data, error } = await identity.service.rpc(
    "financial_report_snapshot",
    {
      target_org: identity.membership.organization_id,
      actor_user: identity.user.id,
      report_from: query.from,
      report_to: query.to,
      date_basis: query.dateBasis,
      currency_filter: query.currency,
      status_filter: query.status ?? undefined,
      customer_filter: query.customer ?? undefined,
    },
  );
  if (error) {
    logError("Načtení snapshotu finančního reportu selhalo", {
      code: error.code,
      message: error.message,
    });
    if (error.code === "PGRST202" || error.code === "42883")
      throw new PageDataError(
        "Export PDF není v databázi připravený. Chybí aktualizace finančních reportů; požádejte správce o její nasazení.",
        503,
      );
    if (error.message.includes("report_too_large"))
      throw new PageDataError(
        "Export překračuje limit 5 000 faktur nebo 2 000 výpisů. Zúžte období či filtry; žádná data nebyla vynechána.",
        413,
      );
    if (error.message.includes("insufficient_permission"))
      throw new PageDataError("K reportu nemáte přístup.", 403);
    throw new PageDataError(
      "Data pro report se nepodařilo načíst. Zkuste to znovu.",
      503,
    );
  }
  const snapshot = data as unknown as FinancialReportSnapshot;
  if (
    !snapshot?.company?.name ||
    !snapshot.report ||
    !snapshot.payments ||
    !Array.isArray(snapshot.invoices) ||
    !Array.isArray(snapshot.customers) ||
    !Array.isArray(snapshot.imports) ||
    snapshot.report.invoice_count !== snapshot.invoices.length ||
    snapshot.payments.totals.imports !== snapshot.imports.length
  )
    throw new PageDataError(
      "Úplnost dat reportu se nepodařilo ověřit. Export nebyl vytvořen.",
      503,
    );
  return snapshot;
}
