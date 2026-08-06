import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { createCsv } from "@/lib/csv";
import { demoInvoices } from "@/lib/demo-data";
import { buildInvoiceReport, invoiceDateForReport, parseReportQuery, type InvoiceReport } from "@/lib/report-query";
import { todayInTimeZone } from "@/lib/reminders";
import { isDemoMode } from "@/lib/supabase-server";
import type { Invoice, InvoiceStatus } from "@/types/invoice";

const EXPORT_PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 20_000;
const statusLabels: Record<InvoiceStatus, string> = { pending: "Čeká", overdue: "Po splatnosti", paid: "Zaplaceno", cancelled: "Storno" };
type ReportRow = Pick<Invoice, "invoice_number" | "counterparty_name" | "amount" | "paid_amount" | "currency" | "issue_date" | "due_date" | "paid_at" | "status" | "reminders_sent"> & { remaining_amount?: number };
type ReportRowsPage = { rows: (ReportRow & { id: string })[]; total: number };

function reportCsv(rows: ReportRow[]) {
  return createCsv([["Faktura", "Odběratel", "Částka", "Uhrazená částka", "Zbývá", "Měna", "Vystavení", "Splatnost", "Datum úplné úhrady", "Stav", "Upomínky"],
    ...rows.map(invoice => [invoice.invoice_number, invoice.counterparty_name, invoice.amount, invoice.paid_amount, invoice.remaining_amount ?? Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount)), invoice.currency, invoice.issue_date, invoice.due_date, invoice.paid_at?.slice(0, 10) ?? "", statusLabels[invoice.status], invoice.reminders_sent])]);
}

function csvResponse(rows: ReportRow[]) {
  return new Response(reportCsv(rows), { headers: {
    "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=report-faktur.csv", "cache-control": "private, no-store",
  } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = parseReportQuery(url.searchParams);
  if (!query) return NextResponse.json({ error: "Zkontrolujte období a filtry reportu." }, { status: 400 });
  const wantsCsv = url.searchParams.get("format") === "csv";

  if (isDemoMode()) {
    const filtered = demoInvoices.filter(invoice => {
      const reportDate = invoiceDateForReport(invoice, query.dateBasis);
      return Boolean(reportDate && reportDate >= query.from && reportDate <= query.to)
        && invoice.currency === query.currency && (!query.status || invoice.status === query.status)
        && (!query.customer || invoice.counterparty_name === query.customer);
    });
    if (wantsCsv) return csvResponse(filtered);
    return NextResponse.json(buildInvoiceReport(filtered, query.currency, todayInTimeZone(), demoInvoices));
  }

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  const common = {
    target_org: identity.membership.organization_id, actor_user: identity.user.id,
    report_from: query.from, report_to: query.to, date_basis: query.dateBasis,
    currency_filter: query.currency, status_filter: query.status, customer_filter: query.customer,
  };
  if (!wantsCsv) {
    const { data, error } = await identity.service.rpc("invoice_report_summary", { ...common, as_of_date: todayInTimeZone() });
    if (error || !data) return NextResponse.json({ error: "Report se nepodařilo sestavit. Zkontrolujte databázovou migraci." }, { status: 500 });
    return NextResponse.json(data as InvoiceReport, { headers: { "cache-control": "private, no-store" } });
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
  return csvResponse(rows);
}
