import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { createExcelWorkbook, excelDate, excelResponse } from "@/lib/excel-export";
import { demoInvoices } from "@/lib/demo-data";
import { buildInvoiceReport, invoiceDateForReport, parseReportQuery } from "@/lib/report-query";
import { todayInTimeZone } from "@/lib/reminders";
import { isDemoMode } from "@/lib/supabase-server";
import type { Invoice, InvoiceStatus } from "@/types/invoice";
import { canViewFinancialInsights } from "@/lib/role-access";
import { loadReportPageData } from "@/lib/report-page-data";
import { PageDataError } from "@/lib/dashboard-page-data";

const EXPORT_PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 20_000;
const statusLabels: Record<InvoiceStatus, string> = { pending: "Čeká", overdue: "Po splatnosti", paid: "Zaplaceno", cancelled: "Storno" };
type ReportRow = Pick<Invoice, "invoice_number" | "counterparty_name" | "amount_without_vat" | "vat_rate" | "amount" | "paid_amount" | "currency" | "issue_date" | "due_date" | "paid_at" | "status" | "reminders_sent"> & { remaining_amount?: number };
type ReportRowsPage = { rows: (ReportRow & { id: string })[]; total: number };

async function reportExcel(rows: ReportRow[]) {
  const moneyFormat = "#,##0.00";
  return createExcelWorkbook("Report faktur", [
    { header: "Faktura", key: "number", width: 18 }, { header: "Odběratel", key: "customer", width: 32 },
    { header: "Částka bez DPH", key: "net", width: 19, numberFormat: moneyFormat }, { header: "Sazba DPH", key: "vat", width: 14, numberFormat: '0.##" %"' },
    { header: "Částka s DPH", key: "gross", width: 18, numberFormat: moneyFormat }, { header: "Uhrazená částka", key: "paid", width: 19, numberFormat: moneyFormat },
    { header: "Zbývá", key: "remaining", width: 16, numberFormat: moneyFormat }, { header: "Měna", key: "currency", width: 10 },
    { header: "Vystavení", key: "issued", width: 14, numberFormat: "dd.mm.yyyy" }, { header: "Splatnost", key: "due", width: 14, numberFormat: "dd.mm.yyyy" },
    { header: "Datum úplné úhrady", key: "paidAt", width: 22, numberFormat: "dd.mm.yyyy" }, { header: "Stav", key: "status", width: 17 },
    { header: "Upomínky", key: "reminders", width: 12, numberFormat: "0" },
  ], rows.map(invoice => ({ number: invoice.invoice_number, customer: invoice.counterparty_name, net: Number(invoice.amount_without_vat),
    vat: Number(invoice.vat_rate), gross: Number(invoice.amount), paid: Number(invoice.paid_amount),
    remaining: Number(invoice.remaining_amount ?? Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount))), currency: invoice.currency,
    issued: excelDate(invoice.issue_date), due: excelDate(invoice.due_date), paidAt: excelDate(invoice.paid_at),
    status: statusLabels[invoice.status], reminders: invoice.reminders_sent })));
}

export async function GET(request: Request) {
  const requestStartedAt = performance.now();
  const url = new URL(request.url);
  const query = parseReportQuery(url.searchParams);
  if (!query) return NextResponse.json({ error: "Zkontrolujte období a filtry reportu." }, { status: 400 });
  const wantsExcel = url.searchParams.get("format") === "xlsx";

  if (isDemoMode()) {
    const filtered = demoInvoices.filter(invoice => {
      const reportDate = invoiceDateForReport(invoice, query.dateBasis);
      return Boolean(reportDate && reportDate >= query.from && reportDate <= query.to)
        && invoice.currency === query.currency && (!query.status || invoice.status === query.status)
        && (!query.customer || invoice.counterparty_name === query.customer);
    });
    if (wantsExcel) return excelResponse(await reportExcel(filtered), "report-faktur.xlsx");
    return NextResponse.json(buildInvoiceReport(filtered, query.currency, todayInTimeZone(), demoInvoices));
  }

  const identity = await getRequestIdentity();
  const identityDoneAt = performance.now();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewFinancialInsights(identity.membership.role)) return NextResponse.json({ error: "K reportům nemáte přístup." }, { status: 403 });
  const common = {
    target_org: identity.membership.organization_id, actor_user: identity.user.id,
    report_from: query.from, report_to: query.to, date_basis: query.dateBasis,
    currency_filter: query.currency, status_filter: query.status ?? undefined, customer_filter: query.customer ?? undefined,
  };
  if (!wantsExcel) {
    try {
      const data = await loadReportPageData(identity, query);
      const dataDoneAt = performance.now();
      const response = NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
      const finishedAt = performance.now();
      response.headers.set("server-timing", `auth;dur=${Math.round(identityDoneAt - requestStartedAt)}, data;dur=${Math.round(dataDoneAt - identityDoneAt)}, response;dur=${Math.round(finishedAt - dataDoneAt)}, total;dur=${Math.round(finishedAt - requestStartedAt)}`);
      return response;
    } catch (error) {
      if (error instanceof PageDataError) return NextResponse.json({ error: error.message }, { status: error.status });
      return NextResponse.json({ error: "Report se nepodařilo sestavit." }, { status: 500 });
    }
  }

  const loadPage = async (page: number) => {
    const { data, error } = await identity.service.rpc("invoice_report_rows_page", { ...common, page_number: page, page_size: EXPORT_PAGE_SIZE });
    return { data: data as ReportRowsPage | null, error };
  };
  const first = await loadPage(1);
  if (first.error || !first.data) return NextResponse.json({ error: "Export reportu se nepodařilo připravit." }, { status: 500 });
  if (first.data.total > MAX_EXPORT_ROWS) return NextResponse.json({ error: `Export obsahuje více než ${MAX_EXPORT_ROWS.toLocaleString("cs-CZ")} řádků. Zpřesněte období nebo filtry.` }, { status: 413 });
  const rows: ReportRow[] = [...first.data.rows];
  for (let page = 2; page <= Math.ceil(first.data.total / EXPORT_PAGE_SIZE); page++) {
    const next = await loadPage(page);
    if (next.error || !next.data) return NextResponse.json({ error: "Export reportu se nepodařilo dokončit." }, { status: 500 });
    rows.push(...next.data.rows);
  }
  return excelResponse(await reportExcel(rows), "report-faktur.xlsx");
}
