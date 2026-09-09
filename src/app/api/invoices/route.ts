import { NextResponse } from "next/server";
import { demoInvoices } from "@/lib/demo-data";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import {
  isDemoMode,
} from "@/lib/supabase-server";
import type { Invoice } from "@/types/invoice";
import { initialNextReminderAt, todayInTimeZone } from "@/lib/reminders";
import { parseInvoiceInput } from "@/lib/invoice-validation";
import { isSameOriginMutation } from "@/lib/request-security";
import { parseInvoiceListQuery } from "@/lib/invoice-list-query";
import { createExcelWorkbook, excelDate, excelResponse } from "@/lib/excel-export";
import { loadInvoiceListPageData } from "@/lib/invoice-list-page-data";
import { PageDataError } from "@/lib/dashboard-page-data";

const LIST_PAGE_SIZE = 25;
const EXPORT_PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 20_000;
const invoiceStatusLabels = { pending: "Čeká na úhradu", overdue: "Po splatnosti", paid: "Zaplaceno", cancelled: "Stornováno" } as const;

type InvoicePageResult = {
  invoices: Invoice[];
  total: number;
  open_totals: Record<string, number>;
  currencies: string[];
  active_count: number;
};

function demoInvoicePage(query: NonNullable<ReturnType<typeof parseInvoiceListQuery>>, pageSize: number): InvoicePageResult {
  const needle = query.query.toLocaleLowerCase("cs");
  const filtered = demoInvoices.filter(invoice =>
    (!query.status || (query.status === "closed" ? invoice.status === "paid" || invoice.status === "cancelled" : invoice.status === query.status))
    && (!query.currency || invoice.currency === query.currency)
    && (!query.from || invoice.issue_date >= query.from)
    && (!query.to || invoice.issue_date <= query.to)
    && (!needle || [invoice.invoice_number, invoice.counterparty_name, invoice.counterparty_email, invoice.variable_symbol]
      .some(value => value?.toLocaleLowerCase("cs").includes(needle)))
  ).sort((a, b) => {
    const priority: Record<Invoice["status"], number> = { overdue: 0, pending: 1, paid: 2, cancelled: 3 };
    const rank = priority[a.status] - priority[b.status];
    if (rank) return rank;
    if (a.status === "overdue" || a.status === "pending") {
      return a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id);
    }
    if (a.status === "paid" && b.status === "paid") {
      return (b.paid_at ?? b.updated_at).localeCompare(a.paid_at ?? a.updated_at) || a.id.localeCompare(b.id);
    }
    return b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id);
  });
  const openTotals: Record<string, number> = {};
  for (const invoice of filtered) if (invoice.status === "pending" || invoice.status === "overdue") openTotals[invoice.currency] = (openTotals[invoice.currency] ?? 0) + Number(invoice.amount) - Number(invoice.paid_amount);
  const offset = (query.page - 1) * pageSize;
  return {
    invoices: filtered.slice(offset, offset + pageSize), total: filtered.length, open_totals: openTotals,
    currencies: [...new Set(demoInvoices.map(invoice => invoice.currency))].sort(),
    active_count: demoInvoices.filter(invoice => invoice.status === "pending" || invoice.status === "overdue").length,
  };
}

async function invoiceExcel(invoices: Invoice[]) {
  const moneyFormat = "#,##0.00";
  return createExcelWorkbook("Faktury", [
    { header: "Číslo faktury", key: "number", width: 18 }, { header: "Odběratel", key: "customer", width: 32 },
    { header: "IČO", key: "ico", width: 13 }, { header: "E-mail", key: "email", width: 30 },
    { header: "Částka bez DPH", key: "net", width: 19, numberFormat: moneyFormat }, { header: "Sazba DPH", key: "vat", width: 14, numberFormat: '0.##" %"' },
    { header: "Částka s DPH", key: "gross", width: 18, numberFormat: moneyFormat }, { header: "Uhrazeno", key: "paid", width: 16, numberFormat: moneyFormat },
    { header: "Zbývá", key: "remaining", width: 16, numberFormat: moneyFormat }, { header: "Měna", key: "currency", width: 10 },
    { header: "Vystavení", key: "issued", width: 14, numberFormat: "dd.mm.yyyy" }, { header: "Splatnost", key: "due", width: 14, numberFormat: "dd.mm.yyyy" },
    { header: "Stav", key: "status", width: 18 }, { header: "Upomínky", key: "reminders", width: 12, numberFormat: "0" },
  ], invoices.map(invoice => ({ number: invoice.invoice_number, customer: invoice.counterparty_name, ico: invoice.counterparty_ico,
    email: invoice.counterparty_email, net: Number(invoice.amount_without_vat), vat: Number(invoice.vat_rate), gross: Number(invoice.amount),
    paid: Number(invoice.paid_amount), remaining: Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount)), currency: invoice.currency,
    issued: excelDate(invoice.issue_date), due: excelDate(invoice.due_date), status: invoiceStatusLabels[invoice.status], reminders: invoice.reminders_sent })));
}

export async function GET(request: Request) {
  const requestStartedAt = performance.now();
  const url = new URL(request.url);
  const query = parseInvoiceListQuery(url.searchParams);
    if (!query) return NextResponse.json({ error: "Neplatný filtr, období nebo číslo stránky." }, { status: 400 });
    const wantsExcel = url.searchParams.get("format") === "xlsx";
    if (isDemoMode()) {
      const result = demoInvoicePage(wantsExcel ? { ...query, page: 1 } : query, wantsExcel ? MAX_EXPORT_ROWS : LIST_PAGE_SIZE);
      if (wantsExcel) return excelResponse(await invoiceExcel(result.invoices), "faktury.xlsx");
      return NextResponse.json({ ...result, can_manage: true, page: query.page, page_size: LIST_PAGE_SIZE, total_pages: Math.max(1, Math.ceil(result.total / LIST_PAGE_SIZE)) });
    }

    const identity = await getRequestIdentity();
    const identityDoneAt = performance.now();
    if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
    const loadPage = async (page: number, size: number) => {
      const { data, error } = await identity.service.rpc("list_invoices_page", {
        target_org: identity.membership.organization_id, actor_user: identity.user.id,
        search_query: query.query || undefined, status_filter: query.status ?? undefined, currency_filter: query.currency ?? undefined,
        issue_from: query.from ?? undefined, issue_to: query.to ?? undefined, page_number: page, page_size: size,
      });
      return { data: data as InvoicePageResult | null, error };
    };
    if (wantsExcel) {
      const first = await loadPage(1, EXPORT_PAGE_SIZE);
      if (first.error || !first.data) return NextResponse.json({ error: "Export se nepodařilo připravit. Zkontrolujte databázovou migraci." }, { status: 500 });
      if (first.data.total > MAX_EXPORT_ROWS) return NextResponse.json({ error: `Export obsahuje více než ${MAX_EXPORT_ROWS.toLocaleString("cs-CZ")} řádků. Zpřesněte období nebo další filtry.` }, { status: 413 });
      const invoices = [...first.data.invoices];
      const pages = Math.ceil(first.data.total / EXPORT_PAGE_SIZE);
      for (let page = 2; page <= pages; page++) {
        const next = await loadPage(page, EXPORT_PAGE_SIZE);
        if (next.error || !next.data) return NextResponse.json({ error: "Export se nepodařilo dokončit." }, { status: 500 });
        invoices.push(...next.data.invoices);
      }
      return excelResponse(await invoiceExcel(invoices), "faktury.xlsx");
    }
    try {
      const result = await loadInvoiceListPageData(identity, query);
      const dataDoneAt = performance.now();
      const response = NextResponse.json(result, { headers: { "cache-control": "private, no-store" } });
      const finishedAt = performance.now();
      response.headers.set("server-timing", `auth;dur=${Math.round(identityDoneAt - requestStartedAt)}, data;dur=${Math.round(dataDoneAt - identityDoneAt)}, response;dur=${Math.round(finishedAt - dataDoneAt)}, total;dur=${Math.round(finishedAt - requestStartedAt)}`);
      return response;
    } catch (error) {
      if (error instanceof PageDataError) return NextResponse.json({ error: error.message }, { status: error.status });
      return NextResponse.json({ error: "Faktury se nepodařilo načíst." }, { status: 500 });
    }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const input = parseInvoiceInput(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json(
      { error: "Zkontrolujte povinná pole, e-mail, částku a data faktury." },
      { status: 400 }
    );
  }

  if (isDemoMode()) {
    const now = new Date().toISOString();
    return NextResponse.json(
      {
        invoice: {
          ...input,
          id: crypto.randomUUID(),
          organization_id: "demo-org",
          reminder_policy_id: input.reminder_policy_id ?? "00000000-0000-4000-8000-000000000001",
          reminder_days_snapshot: [-3, 0, 7, 14],
          reminder_plan_effective_from: null,
          status: "pending",
          paid_amount: 0,
          file_url: input.file_url ?? null,
          paid_at: null,
          reminders_sent: 0,
          last_reminder_at: null,
          next_reminder_at: null,
          created_at: now,
          updated_at: now,
        },
      },
      { status: 201 }
    );
  }

  const identity = await getRequestIdentity();
  if (!identity) {
    return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  }
  if (!canManageInvoices(identity.membership.role)) {
    return NextResponse.json({ error: "Nemáte oprávnění vytvářet faktury." }, { status: 403 });
  }

  const organizationId = identity.membership.organization_id;
  let verifiedUploadId: string | null = null;
  if (input.file_url) {
    if (!input.file_url.startsWith(`${organizationId}/`)) return NextResponse.json({ error: "Dokument nepatří do této organizace." }, { status: 403 });
    const { data: upload } = await identity.service.from("invoice_uploads").select("id")
      .eq("organization_id", organizationId).eq("path", input.file_url).eq("created_by", identity.user.id)
      .eq("status", "verified").gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!upload) return NextResponse.json({ error: "Dokument není bezpečně ověřený nebo jeho nahrávání vypršelo." }, { status: 400 });
    verifiedUploadId = upload.id;
  }

  let policyQuery = identity.service
    .from("reminder_policies")
    .select("id, days_from_due, is_active")
    .eq("organization_id", organizationId)
    .is("archived_at", null);
  policyQuery = input.reminder_policy_id
    ? policyQuery.eq("id", input.reminder_policy_id)
    : policyQuery.eq("is_default", true);
  const { data: selectedPolicy, error: policyError } = await policyQuery.maybeSingle();
  if (policyError || !selectedPolicy) return NextResponse.json({ error: "Vybraná kategorie upomínek není dostupná." }, { status: 400 });
  const reminderDays = selectedPolicy.days_from_due ?? [-3, 0, 7, 14];

  const { data, error } = await identity.service
    .from("invoices")
    .insert({
      ...input,
      file_url: input.file_url ?? null,
      organization_id: organizationId,
      reminder_policy_id: selectedPolicy.id,
      reminder_days_snapshot: reminderDays,
      reminder_plan_effective_from: null,
      next_reminder_at: selectedPolicy.is_active === false
        ? null
        : initialNextReminderAt(
            input.due_date,
            reminderDays,
            todayInTimeZone()
          ),
      created_by: identity.user.id,
    })
    .select("*")
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json(
      { error: status === 409 ? "Číslo faktury nebo přiložený dokument už je evidován." : "Fakturu se nepodařilo uložit." },
      { status }
    );
  }
  if (verifiedUploadId) {
    await identity.service.from("invoice_uploads").update({ status: "claimed", invoice_id: data.id })
      .eq("id", verifiedUploadId).eq("status", "verified");
  }
  return NextResponse.json({ invoice: data }, { status: 201 });
}
