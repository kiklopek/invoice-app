import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import type { Invoice } from "@/types/invoice";
import { initialNextReminderAt, todayInTimeZone } from "@/lib/reminders";
import { parseInvoiceInput } from "@/lib/invoice-validation";
import { isSameOriginMutation } from "@/lib/request-security";
import { parseInvoiceListQuery } from "@/lib/invoice-list-query";
import {
  createExcelWorkbook,
  excelDate,
  excelResponse,
} from "@/lib/excel-export";
import { loadInvoiceListPageData } from "@/lib/invoice-list-page-data";
import { PageDataError } from "@/lib/dashboard-page-data";

const EXPORT_PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 20_000;
const invoiceStatusLabels = {
  pending: "Čeká na úhradu",
  overdue: "Po splatnosti",
  paid: "Zaplaceno",
  cancelled: "Stornováno",
} as const;

type InvoicePageResult = {
  invoices: Invoice[];
  total: number;
  open_totals: Record<string, number>;
  currencies: string[];
  active_count: number;
};

async function invoiceExcel(invoices: Invoice[]) {
  const moneyFormat = "#,##0.00";
  return createExcelWorkbook(
    "Faktury",
    [
      { header: "Číslo faktury", key: "number", width: 18 },
      { header: "Odběratel", key: "customer", width: 32 },
      { header: "IČO", key: "ico", width: 13 },
      { header: "E-mail", key: "email", width: 30 },
      {
        header: "Částka bez DPH",
        key: "net",
        width: 19,
        numberFormat: moneyFormat,
      },
      { header: "Sazba DPH", key: "vat", width: 14, numberFormat: '0.##" %"' },
      {
        header: "Částka s DPH",
        key: "gross",
        width: 18,
        numberFormat: moneyFormat,
      },
      { header: "Uhrazeno", key: "paid", width: 16, numberFormat: moneyFormat },
      {
        header: "Zbývá",
        key: "remaining",
        width: 16,
        numberFormat: moneyFormat,
      },
      { header: "Měna", key: "currency", width: 10 },
      {
        header: "Vystavení",
        key: "issued",
        width: 14,
        numberFormat: "dd.mm.yyyy",
      },
      {
        header: "Splatnost",
        key: "due",
        width: 14,
        numberFormat: "dd.mm.yyyy",
      },
      { header: "Stav", key: "status", width: 18 },
      { header: "Upomínky", key: "reminders", width: 12, numberFormat: "0" },
    ],
    invoices.map((invoice) => ({
      number: invoice.invoice_number,
      customer: invoice.counterparty_name,
      ico: invoice.counterparty_ico,
      email: invoice.counterparty_email,
      net: Number(invoice.amount_without_vat),
      vat: Number(invoice.vat_rate),
      gross: Number(invoice.amount),
      paid: Number(invoice.paid_amount),
      remaining: Math.max(
        0,
        Number(invoice.amount) - Number(invoice.paid_amount),
      ),
      currency: invoice.currency,
      issued: excelDate(invoice.issue_date),
      due: excelDate(invoice.due_date),
      status: invoiceStatusLabels[invoice.status],
      reminders: invoice.reminders_sent,
    })),
  );
}

export async function GET(request: Request) {
  const requestStartedAt = performance.now();
  const url = new URL(request.url);
  const query = parseInvoiceListQuery(url.searchParams);
  if (!query)
    return NextResponse.json(
      { error: "Neplatný filtr, období nebo číslo stránky." },
      { status: 400 },
    );
  const wantsExcel = url.searchParams.get("format") === "xlsx";

  const identity = await getRequestIdentity();
  const identityDoneAt = performance.now();
  if (!identity)
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel." },
      { status: 401 },
    );
  const loadPage = async (page: number, size: number) => {
    const { data, error } = await identity.service.rpc(
      "list_invoices_page_filtered",
      {
        target_org: identity.membership.organization_id,
        actor_user: identity.user.id,
        search_query: query.query || undefined,
        status_filter: query.status ?? undefined,
        currency_filter: query.currency ?? undefined,
        issue_from: query.from ?? undefined,
        issue_to: query.to ?? undefined,
        page_number: page,
        page_size: size,
        due_from: query.dueFrom ?? undefined,
        due_to: query.dueTo ?? undefined,
        amount_min: query.amountMin ?? undefined,
        amount_max: query.amountMax ?? undefined,
        payment_state: query.paymentState ?? undefined,
        bank_match_state: query.bankMatch ?? undefined,
      },
    );
    return { data: data as InvoicePageResult | null, error };
  };
  if (wantsExcel) {
    const first = await loadPage(1, EXPORT_PAGE_SIZE);
    if (first.error || !first.data)
      return NextResponse.json(
        {
          error:
            "Export se nepodařilo připravit. Zkontrolujte databázovou migraci.",
        },
        { status: 500 },
      );
    if (first.data.total > MAX_EXPORT_ROWS)
      return NextResponse.json(
        {
          error: `Export obsahuje více než ${MAX_EXPORT_ROWS.toLocaleString("cs-CZ")} řádků. Zpřesněte období nebo další filtry.`,
        },
        { status: 413 },
      );
    const invoices = [...first.data.invoices];
    const pages = Math.ceil(first.data.total / EXPORT_PAGE_SIZE);
    for (let page = 2; page <= pages; page++) {
      const next = await loadPage(page, EXPORT_PAGE_SIZE);
      if (next.error || !next.data)
        return NextResponse.json(
          { error: "Export se nepodařilo dokončit." },
          { status: 500 },
        );
      invoices.push(...next.data.invoices);
    }
    return excelResponse(await invoiceExcel(invoices), "faktury.xlsx");
  }
  try {
    const result = await loadInvoiceListPageData(identity, query);
    const dataDoneAt = performance.now();
    const response = NextResponse.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
    const finishedAt = performance.now();
    response.headers.set(
      "server-timing",
      `auth;dur=${Math.round(identityDoneAt - requestStartedAt)}, data;dur=${Math.round(dataDoneAt - identityDoneAt)}, response;dur=${Math.round(finishedAt - dataDoneAt)}, total;dur=${Math.round(finishedAt - requestStartedAt)}`,
    );
    return response;
  } catch (error) {
    if (error instanceof PageDataError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    return NextResponse.json(
      { error: "Faktury se nepodařilo načíst." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Požadavek pochází z nepovoleného webu." },
      { status: 403 },
    );
  const input = parseInvoiceInput(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json(
      { error: "Zkontrolujte povinná pole, e-mail, částku a data faktury." },
      { status: 400 },
    );
  }

  const identity = await getRequestIdentity();
  if (!identity) {
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel." },
      { status: 401 },
    );
  }
  if (!canManageInvoices(identity.membership.role)) {
    return NextResponse.json(
      { error: "Nemáte oprávnění vytvářet faktury." },
      { status: 403 },
    );
  }

  const organizationId = identity.membership.organization_id;
  let verifiedUploadId: string | null = null;
  if (input.file_url) {
    if (!input.file_url.startsWith(`${organizationId}/`))
      return NextResponse.json(
        { error: "Dokument nepatří do této organizace." },
        { status: 403 },
      );
    const { data: upload } = await identity.service
      .from("invoice_uploads")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("path", input.file_url)
      .eq("created_by", identity.user.id)
      .eq("status", "verified")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!upload)
      return NextResponse.json(
        {
          error: "Dokument není bezpečně ověřený nebo jeho nahrávání vypršelo.",
        },
        { status: 400 },
      );
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
  const { data: selectedPolicy, error: policyError } =
    await policyQuery.maybeSingle();
  if (policyError || !selectedPolicy)
    return NextResponse.json(
      { error: "Vybraná kategorie upomínek není dostupná." },
      { status: 400 },
    );
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
      next_reminder_at:
        selectedPolicy.is_active === false
          ? null
          : initialNextReminderAt(
              input.due_date,
              reminderDays,
              todayInTimeZone(),
            ),
      created_by: identity.user.id,
    })
    .select("*")
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json(
      {
        error:
          status === 409
            ? "Číslo faktury nebo přiložený dokument už je evidován."
            : "Fakturu se nepodařilo uložit.",
      },
      { status },
    );
  }
  if (verifiedUploadId) {
    await identity.service
      .from("invoice_uploads")
      .update({ status: "claimed", invoice_id: data.id })
      .eq("id", verifiedUploadId)
      .eq("status", "verified");
  }
  // AFTER INSERT records confirmed initial payments in the ledger. INSERT
  // RETURNING itself can still contain the pre-trigger balance/status.
  if ((input.money_evidence?.initial_paid ?? 0) > 0) {
    const { data: refreshed, error: refreshError } = await identity.service.from("invoices")
      .select("*").eq("id", data.id).eq("organization_id", organizationId).single();
    if (refreshError) return NextResponse.json({ invoice: data, refresh_required: true }, { status: 201 });
    return NextResponse.json({ invoice: refreshed }, { status: 201 });
  }
  return NextResponse.json({ invoice: data }, { status: 201 });
}
