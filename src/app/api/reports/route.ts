import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { getRequestIdentity } from "@/lib/auth";
import { createMultiSheetExcelWorkbook, excelDate, excelResponse, type ExcelSheet } from "@/lib/excel-export";
import { parseReportQuery, type InvoiceReport } from "@/lib/report-query";
import type { Invoice, InvoiceStatus } from "@/types/invoice";
import { canViewFinancialInsights } from "@/lib/role-access";
import { loadReportPageData } from "@/lib/report-page-data";
import { PageDataError } from "@/lib/dashboard-page-data";

const EXPORT_PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 20_000;
const statusLabels: Record<InvoiceStatus, string> = { pending: "Čeká", overdue: "Po splatnosti", paid: "Zaplaceno", cancelled: "Storno" };
type ReportRow = Pick<Invoice, "invoice_number" | "counterparty_name" | "amount_without_vat" | "vat_rate" | "amount" | "paid_amount" | "currency" | "issue_date" | "due_date" | "paid_at" | "status" | "reminders_sent"> & { remaining_amount?: number };
type ReportRowsPage = { rows: (ReportRow & { id: string })[]; total: number };

function invoiceRowsSheet(rows: ReportRow[]): ExcelSheet {
  const moneyFormat = "#,##0.00";
  return {
    name: "Report faktur",
    columns: [
      { header: "Faktura", key: "number", width: 18 }, { header: "Odběratel", key: "customer", width: 32 },
      { header: "Částka bez DPH", key: "net", width: 19, numberFormat: moneyFormat }, { header: "Sazba DPH", key: "vat", width: 14, numberFormat: '0.##" %"' },
      { header: "Částka s DPH", key: "gross", width: 18, numberFormat: moneyFormat }, { header: "Uhrazená částka", key: "paid", width: 19, numberFormat: moneyFormat },
      { header: "Zbývá", key: "remaining", width: 16, numberFormat: moneyFormat }, { header: "Měna", key: "currency", width: 10 },
      { header: "Vystavení", key: "issued", width: 14, numberFormat: "dd.mm.yyyy" }, { header: "Splatnost", key: "due", width: 14, numberFormat: "dd.mm.yyyy" },
      { header: "Datum úplné úhrady", key: "paidAt", width: 22, numberFormat: "dd.mm.yyyy" }, { header: "Stav", key: "status", width: 17 },
      { header: "Upomínky", key: "reminders", width: 12, numberFormat: "0" },
    ],
    rows: rows.map(invoice => ({ number: invoice.invoice_number, customer: invoice.counterparty_name, net: Number(invoice.amount_without_vat),
      vat: Number(invoice.vat_rate), gross: Number(invoice.amount), paid: Number(invoice.paid_amount),
      remaining: Number(invoice.remaining_amount ?? Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount))), currency: invoice.currency,
      issued: excelDate(invoice.issue_date), due: excelDate(invoice.due_date), paidAt: excelDate(invoice.paid_at),
      status: statusLabels[invoice.status], reminders: invoice.reminders_sent })),
  };
}

function vatBreakdownSheet(vatBreakdown: InvoiceReport["vat_breakdown"]): ExcelSheet {
  const moneyFormat = "#,##0.00";
  const totalBase = vatBreakdown.reduce((sum, row) => sum + Number(row.base), 0);
  const totalTax = vatBreakdown.reduce((sum, row) => sum + Number(row.tax), 0);
  const totalGross = vatBreakdown.reduce((sum, row) => sum + Number(row.gross), 0);
  const totalCount = vatBreakdown.reduce((sum, row) => sum + row.count, 0);
  return {
    name: "DPH přehled",
    columns: [
      { header: "Sazba DPH", key: "rate", width: 14, numberFormat: '0.##" %"' },
      { header: "Základ daně", key: "base", width: 18, numberFormat: moneyFormat },
      { header: "Daň", key: "tax", width: 16, numberFormat: moneyFormat },
      { header: "Celkem", key: "gross", width: 18, numberFormat: moneyFormat },
      { header: "Počet faktur", key: "count", width: 14, numberFormat: "0" },
    ],
    rows: [
      ...vatBreakdown.map(row => ({ rate: Number(row.vat_rate), base: Number(row.base), tax: Number(row.tax), gross: Number(row.gross), count: row.count })),
      { rate: "Celkem", base: totalBase, tax: totalTax, gross: totalGross, count: totalCount },
    ],
  };
}

function agingSheet(aging: InvoiceReport["aging"]): ExcelSheet {
  const moneyFormat = "#,##0.00";
  return {
    name: "Aging pohledávek",
    columns: [
      { header: "Interval splatnosti", key: "label", width: 22 },
      { header: "Částka", key: "amount", width: 18, numberFormat: moneyFormat },
      { header: "Počet faktur", key: "count", width: 14, numberFormat: "0" },
    ],
    rows: aging.map(bucket => ({ label: bucket.label, amount: Number(bucket.amount), count: bucket.count })),
  };
}

export async function GET(request: Request) {
  const requestStartedAt = performance.now();
  const url = new URL(request.url);
  const query = parseReportQuery(url.searchParams);
  if (!query) return NextResponse.json({ error: "Zkontrolujte období a filtry reportu." }, { status: 400 });
  const wantsExcel = url.searchParams.get("format") === "xlsx";

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
      logError("Report se nepodařilo sestavit", error);
      return apiError(request, "Report se nepodařilo sestavit.", 500, "report_build_failed");
    }
  }

  const loadPage = async (page: number) => {
    const { data, error } = await identity.service.rpc("invoice_report_rows_page", { ...common, page_number: page, page_size: EXPORT_PAGE_SIZE });
    return { data: data as ReportRowsPage | null, error };
  };
  const first = await loadPage(1);
  if (first.error || !first.data) {
    logError("První stránku exportu reportu se nepodařilo načíst", first.error);
    return apiError(request, "Export reportu se nepodařilo připravit.", 500, "report_export_failed");
  }
  if (first.data.total > MAX_EXPORT_ROWS) return NextResponse.json({ error: `Export obsahuje více než ${MAX_EXPORT_ROWS.toLocaleString("cs-CZ")} řádků. Zpřesněte období nebo filtry.` }, { status: 413 });
  const rows: ReportRow[] = [...first.data.rows];
  for (let page = 2; page <= Math.ceil(first.data.total / EXPORT_PAGE_SIZE); page++) {
    const next = await loadPage(page);
    if (next.error || !next.data) {
      logError("Další stránku exportu reportu se nepodařilo načíst", next.error, { page });
      return apiError(request, "Export reportu se nepodařilo dokončit.", 500, "report_export_failed");
    }
    rows.push(...next.data.rows);
  }

  // Direct RPC call rather than loadReportPageData: the export only needs
  // vat_breakdown/aging, not the payment_reconciliation summary that
  // loadReportPageData fetches in parallel for the on-screen page.
  const { data: summary, error: summaryError } = await identity.service.rpc("invoice_report_summary", { ...common, as_of_date: new Date().toISOString().slice(0, 10) });
  if (summaryError || !summary) {
    logError("Souhrn pro export reportu se nepodařilo načíst", summaryError);
    return apiError(request, "Export reportu se nepodařilo připravit.", 500, "report_export_failed");
  }
  const { vat_breakdown, aging } = summary as InvoiceReport;

  const workbook = await createMultiSheetExcelWorkbook([invoiceRowsSheet(rows), vatBreakdownSheet(vat_breakdown), agingSheet(aging)]);
  return excelResponse(workbook, "report-faktur.xlsx");
}
