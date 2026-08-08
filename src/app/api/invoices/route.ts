import { NextResponse } from "next/server";
import { demoInvoices } from "@/lib/demo-data";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import {
  isDemoMode,
} from "@/lib/supabase-server";
import type { Invoice, InvoiceInput } from "@/types/invoice";
import { initialNextReminderAt, todayInTimeZone } from "@/lib/reminders";
import { parseInvoiceInput } from "@/lib/invoice-validation";
import { isSameOriginMutation } from "@/lib/request-security";
import { parseInvoiceListQuery } from "@/lib/invoice-list-query";
import { createCsv } from "@/lib/csv";

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

function invoiceCsv(invoices: Invoice[]) {
  return createCsv([["Číslo faktury", "Odběratel", "IČO", "E-mail", "Částka", "Uhrazeno", "Zbývá", "Měna", "Vystavení", "Splatnost", "Stav", "Upomínky"],
    ...invoices.map(invoice => [invoice.invoice_number, invoice.counterparty_name, invoice.counterparty_ico, invoice.counterparty_email, invoice.amount, invoice.paid_amount, Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount)), invoice.currency, invoice.issue_date, invoice.due_date, invoiceStatusLabels[invoice.status], invoice.reminders_sent])]);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = parseInvoiceListQuery(url.searchParams);
    if (!query) return NextResponse.json({ error: "Neplatný filtr, období nebo číslo stránky." }, { status: 400 });
    const wantsCsv = url.searchParams.get("format") === "csv";
    if (isDemoMode()) {
      const result = demoInvoicePage(wantsCsv ? { ...query, page: 1 } : query, wantsCsv ? MAX_EXPORT_ROWS : LIST_PAGE_SIZE);
      if (wantsCsv) return new Response(invoiceCsv(result.invoices), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=faktury.csv" } });
      return NextResponse.json({ ...result, can_manage: true, page: query.page, page_size: LIST_PAGE_SIZE, total_pages: Math.max(1, Math.ceil(result.total / LIST_PAGE_SIZE)) });
    }

    const identity = await getRequestIdentity();
    if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
    const loadPage = async (page: number, size: number) => {
      const { data, error } = await identity.service.rpc("list_invoices_page", {
        target_org: identity.membership.organization_id, actor_user: identity.user.id,
        search_query: query.query || null, status_filter: query.status, currency_filter: query.currency,
        issue_from: query.from, issue_to: query.to, page_number: page, page_size: size,
      });
      return { data: data as InvoicePageResult | null, error };
    };
    if (wantsCsv) {
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
      return new Response(invoiceCsv(invoices), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=faktury.csv", "cache-control": "private, no-store" } });
    }
    const result = await loadPage(query.page, LIST_PAGE_SIZE);
    if (result.error || !result.data) return NextResponse.json({ error: "Faktury se nepodařilo načíst. Zkontrolujte databázovou migraci." }, { status: 500 });
    return NextResponse.json({ ...result.data, can_manage: canManageInvoices(identity.membership.role), page: query.page, page_size: LIST_PAGE_SIZE, total_pages: Math.max(1, Math.ceil(result.data.total / LIST_PAGE_SIZE)) }, { headers: { "cache-control": "private, no-store" } });
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

  const { data: defaultPolicy } = await identity.service
    .from("reminder_policies")
    .select("id, days_from_due, is_active")
    .eq("organization_id", organizationId)
    .eq("is_default", true)
    .maybeSingle();

  const { data, error } = await identity.service
    .from("invoices")
    .insert({
      ...input,
      file_url: input.file_url ?? null,
      organization_id: organizationId,
      reminder_policy_id: defaultPolicy?.id ?? null,
      next_reminder_at: defaultPolicy?.is_active === false
        ? null
        : initialNextReminderAt(
            input.due_date,
            defaultPolicy?.days_from_due ?? [-3, 0, 7, 14],
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
