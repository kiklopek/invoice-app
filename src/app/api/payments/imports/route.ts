import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { parseGpc } from "@/lib/gpc-parser";
import { parseCsvStatement } from "@/lib/csv-statement-parser";
import {
  proposePaymentMatch,
  resolveBatchConflicts,
  type MatchableInvoice,
} from "@/lib/payment-matching";
import { assignStatementPayments } from "@/lib/statement-assignment";
import { detectStatementAccountMismatch, normalizeVariableSymbol, resolveConfiguredAccountForCurrencies } from "@/lib/payment-import";
import { isSameOriginMutation } from "@/lib/request-security";
import type { Json } from "@/types/database";
import { canUseGpcImport } from "@/lib/gpc-feature";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function requestId() {
  return crypto.randomUUID();
}

export async function GET(request: Request) {
  const id = requestId();
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel.", request_id: id },
      { status: 401 },
    );
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = 20;
  const from = (page - 1) * pageSize;
  const { data, error, count } = await identity.service
    .from("bank_statement_imports")
    .select(
      "id, original_filename, source_format, statement_account, status, revision, account_mismatch, entry_count, accepted_count, ignored_count, error_count, created_at, committed_at",
      { count: "exact" },
    )
    .eq("organization_id", identity.membership.organization_id)
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) {
    logError("Archiv importů se nepodařilo načíst", error, { request_id: id });
    return apiError(request, "Archiv importů se nepodařilo načíst.", 500, "statement_archive_read_failed");
  }
  return NextResponse.json({
    imports: data ?? [],
    page,
    page_size: pageSize,
    total: count ?? 0,
    can_manage:
      canManageInvoices(identity.membership.role) &&
      canUseGpcImport(identity.membership.role),
    request_id: id,
  });
}

export async function POST(request: Request) {
  const id = requestId();
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Požadavek pochází z nepovoleného webu.", request_id: id },
      { status: 403 },
    );
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel.", request_id: id },
      { status: 401 },
    );
  if (!canManageInvoices(identity.membership.role))
    return NextResponse.json(
      { error: "Nemáte oprávnění importovat bankovní výpisy.", request_id: id },
      { status: 403 },
    );
  if (!canUseGpcImport(identity.membership.role))
    return NextResponse.json(
      { error: "GPC import zatím není pro vaši roli zapnutý.", request_id: id },
      { status: 403 },
    );
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const fileName = file instanceof File ? file.name.toLowerCase() : "";
  const sourceFormat: "gpc" | "csv" | null = fileName.endsWith(".gpc")
    ? "gpc"
    : fileName.endsWith(".csv")
      ? "csv"
      : null;
  if (!(file instanceof File) || !sourceFormat) {
    return NextResponse.json(
      { error: "Vyberte soubor s příponou .gpc nebo .csv.", request_id: id },
      { status: 400 },
    );
  }
  if (file.size < 1 || file.size > MAX_FILE_BYTES)
    return NextResponse.json(
      { error: "Soubor výpisu musí mít nejvýše 5 MB.", request_id: id },
      { status: 413 },
    );

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = sourceFormat === "gpc" ? parseGpc(bytes) : parseCsvStatement(bytes);
    const org = identity.membership.organization_id;
    const [
      { data: company, error: companyError },
      { data: knownAccounts, error: accountError },
    ] = await Promise.all([
      identity.service
        .from("organizations")
        .select("bank_account_czk, bank_account_eur")
        .eq("id", org)
        .single(),
      identity.service
        .from("counterparty_payment_accounts")
        .select("account_number, counterparty_ico")
        .eq("organization_id", org),
    ]);
    if (companyError || accountError)
      throw new Error("Databázová konfigurace plateb není dostupná.");

    const invoices: MatchableInvoice[] = [];
    for (let from = 0; from <= 10_000; from += 1000) {
      const { data, error } = await identity.service
        .from("invoices")
        .select(
          "id, invoice_number, counterparty_name, counterparty_ico, variable_symbol, currency, amount, paid_amount, due_date, issue_date",
        )
        .eq("organization_id", org)
        .in("status", ["pending", "overdue"])
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error("Otevřené faktury se nepodařilo načíst.");
      if (from === 10_000 && data?.length) throw new Error("Organizace má přes 10 000 otevřených faktur. Automatické návrhy nelze bezpečně sestavit z neúplného seznamu.");
      invoices.push(
        ...(data ?? []).map((invoice) => ({
          ...invoice,
          amount: Number(invoice.amount),
          paid_amount: Number(invoice.paid_amount),
        })),
      );
      if ((data?.length ?? 0) < 1000) break;
    }
    const icoByAccount = new Map<string, string[]>();
    for (const known of knownAccounts ?? [])
      icoByAccount.set(known.account_number, [
        ...(icoByAccount.get(known.account_number) ?? []),
        known.counterparty_ico,
      ]);
    const invoicesByVs = new Map<string, MatchableInvoice[]>();
    const invoicesByCounterparty = new Map<string, MatchableInvoice[]>();
    for (const invoice of invoices) {
      const vsKey = `${invoice.currency}:${normalizeVariableSymbol(invoice.variable_symbol)}`;
      if (normalizeVariableSymbol(invoice.variable_symbol))
        invoicesByVs.set(vsKey, [...(invoicesByVs.get(vsKey) ?? []), invoice]);
      // A payer often writes the invoice NUMBER into the payment's VS when
      // the invoice itself has no separate variable_symbol -- e.g. a
      // template that never surfaces a "Variabilní symbol" field at all, so
      // it's never captured and stays empty. Registering the invoice under
      // this second key too is what lets proposePaymentMatch (which already
      // checks both fields) actually see it as a candidate in the first
      // place; see matchesVariableSymbol in payment-matching.ts.
      const numberKey = `${invoice.currency}:${normalizeVariableSymbol(invoice.invoice_number)}`;
      if (!normalizeVariableSymbol(invoice.variable_symbol) && /^\d+$/.test(invoice.invoice_number.trim()))
        invoicesByVs.set(numberKey, [...(invoicesByVs.get(numberKey) ?? []), invoice]);
      const counterpartyKey =
        invoice.counterparty_ico || invoice.counterparty_name;
      invoicesByCounterparty.set(counterpartyKey, [
        ...(invoicesByCounterparty.get(counterpartyKey) ?? []),
        invoice,
      ]);
    }
    // Decide the statement as a whole first: one payment pays one invoice, and
    // no invoice is claimed twice. Only what this pass declines to judge falls
    // through to the row-by-row matcher below (partial payments, and one
    // payment covering a combination of invoices).
    // Invoices this statement's symbols point at but which are already settled.
    // Fetched by the symbols actually present in the file, so the query stays
    // bounded by the statement rather than by the size of the paid ledger.
    const quotedSymbols = [
      ...new Set(
        parsed.payments.flatMap((payment) => {
          const normalized = normalizeVariableSymbol(payment.variable_symbol);
          return normalized ? [normalized, payment.variable_symbol] : [];
        }),
      ),
    ].filter((value): value is string => Boolean(value));
    const settledInvoices: MatchableInvoice[] = [];
    if (quotedSymbols.length > 0 && quotedSymbols.length <= 500) {
      const columns =
        "id, invoice_number, counterparty_name, counterparty_ico, variable_symbol, currency, amount, paid_amount, due_date, issue_date";
      const [bySymbol, byNumber] = await Promise.all([
        identity.service.from("invoices").select(columns)
          .eq("organization_id", org).eq("status", "paid")
          .in("variable_symbol", quotedSymbols).limit(500),
        identity.service.from("invoices").select(columns)
          .eq("organization_id", org).eq("status", "paid")
          .in("invoice_number", quotedSymbols).limit(500),
      ]);
      for (const invoice of [...(bySymbol.data ?? []), ...(byNumber.data ?? [])])
        settledInvoices.push({
          ...invoice,
          amount: Number(invoice.amount),
          paid_amount: Number(invoice.paid_amount),
        });
    }
    const assignments = assignStatementPayments(
      parsed.entries.flatMap((entry) =>
        entry.payment && entry.disposition === "accepted"
          ? [{ key: entry.fingerprint, ...entry.payment }]
          : [],
      ),
      invoices,
      icoByAccount,
      settledInvoices,
    );
    const entries = resolveBatchConflicts(parsed.entries.map((entry) => {
      const historyIcos = entry.payment
        ? (icoByAccount.get(entry.payment.counterparty_account ?? "") ?? [])
        : [];
      const assigned = assignments.get(entry.fingerprint)?.proposal ?? null;
      const vsMatches = entry.payment
        ? (invoicesByVs.get(
            `${entry.payment.currency}:${normalizeVariableSymbol(entry.payment.variable_symbol)}`,
          ) ?? [])
        : [];
      const directProposal = entry.payment
        ? proposePaymentMatch(entry.payment, vsMatches, historyIcos)
        : null;
      const relevant = new Map<string, MatchableInvoice>();
      for (const invoice of vsMatches) {
        relevant.set(invoice.id, invoice);
        for (const grouped of invoicesByCounterparty.get(
          invoice.counterparty_ico || invoice.counterparty_name,
        ) ?? [])
          relevant.set(grouped.id, grouped);
      }
      for (const ico of historyIcos)
        for (const grouped of invoicesByCounterparty.get(ico) ?? [])
          relevant.set(grouped.id, grouped);
      const proposal =
        assigned ??
        (directProposal?.kind === "exact" || directProposal?.kind === "ambiguous"
          ? directProposal
          : entry.payment
            ? proposePaymentMatch(
                entry.payment,
                [...relevant.values()],
                historyIcos,
              )
            : null);
      return {
        line_number: entry.line,
        record_type: entry.recordType,
        fingerprint: entry.fingerprint,
        disposition: entry.disposition,
        reason: entry.reason ?? null,
        external_id: entry.payment?.external_id ?? null,
        booked_on: entry.payment?.booked_on ?? null,
        amount: entry.payment?.amount ?? null,
        currency: entry.payment?.currency ?? null,
        variable_symbol: entry.payment?.variable_symbol ?? null,
        counterparty_name: entry.payment?.counterparty_name ?? null,
        counterparty_account: entry.payment?.counterparty_account ?? null,
        counterparty_account_verified: entry.payment?.counterparty_account_verified ?? true,
        note: entry.payment?.note ?? null,
        proposal_kind: proposal?.kind ?? null,
        proposal_confidence: proposal?.confidence ?? null,
        proposal_reason: proposal?.reason ?? null,
        proposed_invoice_ids: proposal?.invoiceIds ?? [],
      };
    }));
    const paymentCurrencies = parsed.payments.map((payment) => payment.currency);
    const accountMismatch = detectStatementAccountMismatch({
      statementAccountNumber: parsed.accountNumber,
      paymentCurrencies,
      company,
    });
    const expectedAccount = resolveConfiguredAccountForCurrencies(paymentCurrencies, company);
    const storagePath = `${org}/${parsed.fileHash}.${sourceFormat}`;
    const { error: storageError } = await identity.service.storage
      .from("bank-statements")
      .upload(storagePath, bytes, {
        contentType: sourceFormat === "csv" ? "text/csv" : "application/octet-stream",
        upsert: false,
      });
    if (storageError && !/already exists|duplicate/i.test(storageError.message))
      throw new Error(
        "Originální GPC soubor se nepodařilo uložit do soukromého archivu.",
      );
    const { data, error } = await identity.service.rpc(
      "create_bank_statement_preview",
      {
        target_org: org,
        actor_user: identity.user.id,
        import_data: {
          source_format: sourceFormat,
          original_filename: file.name,
          file_hash: parsed.fileHash,
          storage_path: storagePath,
          statement_account: parsed.accountNumber,
          account_mismatch: accountMismatch,
          accepted_count: parsed.totals.accepted,
          ignored_count: parsed.totals.ignored,
          error_count: parsed.totals.errors,
          automation_mode: process.env.PAYMENT_RECONCILIATION_MODE === "automatic" ? "automatic" : "shadow",
        },
        entry_rows: entries as unknown as Json,
      },
    );
    if (error) {
      // Content-addressed paths are shared by concurrent imports. A failed
      // request must not delete the original another request just committed.
      throw new Error(
        error.message.includes("invalid")
          ? "Výpis obsahuje neplatná data."
          : "Náhled importu se nepodařilo bezpečně uložit.",
      );
    }
    const result = data as {
      id: string;
      revision: number;
      duplicate: boolean;
      status: string;
      totals?: typeof parsed.totals;
      total_entries?: number;
      entries?: typeof entries;
    };
    // Book the safe rows now, rather than leaving them for the cron.
    //
    // The unattended worker runs only from the Vercel cron, so on any other
    // deployment -- a local dev server included -- a statement full of decided
    // rows simply sat there looking like it was waiting for a human. Running it
    // here makes the import itself the trigger; the cron stays as the retry for
    // whatever this pass could not finish. A failure must never fail the import:
    // the preview is already stored and the worker will come back to it.
    // Deliberately NOT gated on `!result.duplicate`: re-uploading the same file
    // is the normal way to retry, and the second upload is exactly when a
    // statement that never got booked most needs to be. The RPC skips entries
    // that already carry a payment, so running it again is harmless.
    if (process.env.PAYMENT_RECONCILIATION_MODE === "automatic" && result.status === "review") {
      const { error: bookingError } = await identity.service.rpc("reconcile_bank_statement", {
        target_org: org,
        actor_user: identity.user.id,
        target_import: result.id,
        expected_revision: result.revision,
        automatic_only: true,
      });
      if (bookingError)
        console.warn(
          JSON.stringify({ event: "import_autobook_failed", request_id: id, import_id: result.id, message: bookingError.message }),
        );
    }

    const previewEntries = result.entries ?? entries.slice(0, 50);
    const previewInvoiceIds = new Set(
      previewEntries.flatMap((entry) => entry.proposed_invoice_ids),
    );
    return NextResponse.json(
      {
        import: result,
        account_mismatch: accountMismatch,
        statement_account: parsed.accountNumber,
        expected_account: expectedAccount,
        totals: result.totals ?? parsed.totals,
        entries: previewEntries,
        // Settled invoices are included so a "this is already paid" proposal can
        // name the invoice it is warning about instead of showing a bare id.
        proposal_invoices: [...invoices, ...settledInvoices].filter(
          (invoice) => previewInvoiceIds.has(invoice.id),
        ),
        total_entries: result.total_entries ?? entries.length,
        request_id: id,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (cause) {
    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "GPC výpis se nepodařilo zpracovat.",
        request_id: id,
      },
      { status: 400 },
    );
  }
}
