import { publicApi, apiQueryError } from "@/lib/public-api";
import { PublicApiError } from "@/lib/public-api-input";
import { parseReportQuery, type InvoiceReport } from "@/lib/report-query";
import { todayInTimeZone } from "@/lib/reminders";
export async function GET(request: Request) {
  return publicApi(request, "reports:read", async identity => {
    const query = parseReportQuery(new URL(request.url).searchParams);
    if (!query) throw new PublicApiError("Zadejte platné období from/to a filtry reportu.");
    const { data, error } = await identity.service.rpc("invoice_report_summary", { target_org: identity.organizationId, actor_user: identity.actingUserId, report_from: query.from, report_to: query.to, date_basis: query.dateBasis, currency_filter: query.currency, status_filter: query.status ?? undefined, customer_filter: query.customer ?? undefined, as_of_date: todayInTimeZone() });
    apiQueryError(error); if (!data) throw new PublicApiError("Report není dostupný.", 503, "report_unavailable");
    const report = data as unknown as InvoiceReport;
    // Versioned stable subset; internal page-only report fields stay private.
    return Response.json({ report: { currency: query.currency, from: query.from, to: query.to, date_basis: query.dateBasis, as_of_date: todayInTimeZone(), invoice_count: report.invoice_count, total: Number(report.total).toFixed(2), paid: Number(report.paid).toFixed(2), overdue: Number(report.overdue).toFixed(2), open: Number(report.open).toFixed(2), paid_rate: report.paid_rate } });
  });
}
