import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import type { Json } from "@/types/database";
import { canUseGpcImport } from "@/lib/gpc-feature";
import { resolveConfiguredAccountForCurrencies } from "@/lib/payment-import";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!uuid.test(id))
    return NextResponse.json({ error: "Neplatný import." }, { status: 400 });
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel." },
      { status: 401 },
    );
  const org = identity.membership.organization_id;
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 20000)
    return NextResponse.json({ error: "Neplatná stránka." }, { status: 400 });
  const disposition = url.searchParams.get("status");
  const allowedDispositions = new Set(["accepted", "ignored", "error", "duplicate"]);
  if (disposition && !allowedDispositions.has(disposition))
    return NextResponse.json({ error: "Neplatný filtr položek." }, { status: 400 });
  const pageSize = 50;
  const { data: statement, error } = await identity.service
    .from("bank_statement_imports")
    .select("*")
    .eq("id", id)
    .eq("organization_id", org)
    .single();
  if (error)
    return NextResponse.json(
      { error: "Import nebyl nalezen." },
      { status: 404 },
    );
  let expectedAccount: string | null = null;
  if (statement.account_mismatch) {
    const [{ data: company }, { data: currencyRows }] = await Promise.all([
      identity.service.from("organizations").select("bank_account_czk, bank_account_eur").eq("id", org).single(),
      identity.service.from("bank_statement_entries").select("currency").eq("import_id", id).eq("disposition", "accepted"),
    ]);
    if (company) {
      const currencies = [...new Set((currencyRows ?? []).map((row) => row.currency).filter((value): value is string => Boolean(value)))];
      expectedAccount = resolveConfiguredAccountForCurrencies(currencies, company);
    }
  }
  if (url.searchParams.get("download") === "1") {
    if (!statement.storage_path)
      return NextResponse.json(
        { error: "Originální soubor není v archivu." },
        { status: 404 },
      );
    const { data, error: signedError } = await identity.service.storage
      .from("bank-statements")
      .createSignedUrl(statement.storage_path, 60);
    if (signedError) {
      logError("Podepsaný odkaz na výpis se nepodařilo vytvořit", signedError, { import_id: id });
      return apiError(request, "Odkaz na soubor se nepodařilo vytvořit.", 500, "statement_signed_url_failed");
    }
    return NextResponse.json({ url: data.signedUrl, expires_in: 60 });
  }
  const from = (page - 1) * pageSize;
  let entryQuery = identity.service
    .from("bank_statement_entries")
    .select("*", { count: "exact" })
    .eq("import_id", id)
    .eq("organization_id", org);
  if (disposition) entryQuery = entryQuery.eq("disposition", disposition);
  const {
    data: entries,
    error: entryError,
    count,
  } = await entryQuery
    .order("line_number")
    .range(from, from + pageSize - 1);
  // Allocations are fetched separately for only the visible entry IDs to keep large imports bounded.
  let visibleAllocations: Array<{
    id: string;
    statement_entry_id: string | null;
    invoice_id: string;
    amount: number;
    is_manual_partial: boolean;
    is_committed: boolean;
  }> = [];
  if ((entries?.length ?? 0) > 0) {
    const fetched = await identity.service
      .from("bank_payment_allocations")
      .select(
        "id, statement_entry_id, invoice_id, amount, is_manual_partial, is_committed",
      )
      .eq("organization_id", org)
      .in(
        "statement_entry_id",
        entries!.map((entry) => entry.id),
      );
    if (fetched.error) {
      logError("Přiřazení plateb se nepodařilo načíst", fetched.error, { import_id: id });
      return apiError(request, "Přiřazení se nepodařilo načíst.", 500, "allocations_read_failed");
    }
    visibleAllocations = fetched.data ?? [];
  }
  if (entryError) {
    logError("Položky importu se nepodařilo načíst", entryError, { import_id: id });
    return apiError(request, "Položky importu se nepodařilo načíst.", 500, "statement_entries_read_failed");
  }
  // Why a booked row was booked. Lives on the payment, not the entry, and only
  // an unattended run fills it -- so the review screen can tell the reader that
  // nobody looked at this one, and on what grounds it went through.
  const bookedPaymentIds = (entries ?? [])
    .map((entry) => entry.bank_payment_id)
    .filter((value): value is string => Boolean(value));
  const matchReasons: Record<string, string> = {};
  if (bookedPaymentIds.length > 0) {
    const fetched = await identity.service
      .from("bank_payments")
      .select("id, match_reason")
      .eq("organization_id", org)
      .in("id", bookedPaymentIds);
    for (const payment of fetched.data ?? [])
      if (payment.match_reason) matchReasons[payment.id] = payment.match_reason;
  }
  const invoiceIds = [
    ...new Set([
      ...(entries ?? []).flatMap((entry) => entry.proposed_invoice_ids ?? []),
      ...visibleAllocations.map((allocation) => allocation.invoice_id),
    ]),
  ];
  let proposalInvoices: Array<{
    id: string;
    invoice_number: string;
    counterparty_name: string;
    amount: number;
    paid_amount: number;
    currency: string;
    variable_symbol: string | null;
  }> = [];
  if (invoiceIds.length > 0) {
    const fetched = await identity.service
      .from("invoices")
      .select(
        "id, invoice_number, counterparty_name, amount, paid_amount, currency, variable_symbol",
      )
      .eq("organization_id", org)
      .in("id", invoiceIds);
    if (fetched.error) {
      logError("Navržené faktury se nepodařilo načíst", fetched.error, { import_id: id });
      return apiError(request, "Navržené faktury se nepodařilo načíst.", 500, "proposal_invoices_read_failed");
    }
    proposalInvoices = fetched.data ?? [];
  }
  const [booked, failed] = await Promise.all([
    identity.service.from("bank_statement_entries").select("id", { count: "exact", head: true })
      .eq("organization_id", org).eq("import_id", id).not("bank_payment_id", "is", null),
    identity.service.from("bank_statement_entries").select("id", { count: "exact", head: true })
      .eq("organization_id", org).eq("import_id", id).eq("disposition", "accepted")
      .is("bank_payment_id", null).not("processing_error", "is", null),
  ]);
  if (booked.error || failed.error) {
    logError("Průběh importu se nepodařilo načíst", booked.error ?? failed.error, { import_id: id });
    return apiError(request, "Průběh importu se nepodařilo načíst.", 500, "import_progress_read_failed");
  }
  return NextResponse.json({
    match_reasons: matchReasons,
    import: statement,
    progress: { booked: booked.count ?? 0, errors: failed.count ?? 0,
      remaining: Math.max(0, statement.accepted_count - (booked.count ?? 0)) },
    totals: { accepted: statement.accepted_count, ignored: statement.ignored_count, errors: statement.error_count },
    total_entries: statement.entry_count,
    expected_account: expectedAccount,
    entries: entries ?? [],
    allocations: visibleAllocations,
    proposal_invoices: proposalInvoices,
    page,
    page_size: pageSize,
    total: count ?? 0,
    can_manage: canManageInvoices(identity.membership.role),
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function PATCH(request: Request, context: Context) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Požadavek pochází z nepovoleného webu." },
      { status: 403 },
    );
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    revision?: unknown;
    reviewed_entry_ids?: unknown;
    allocations?: unknown;
  } | null;
  if (
    !uuid.test(id) ||
    !Number.isInteger(body?.revision) ||
    !Array.isArray(body?.reviewed_entry_ids) ||
    !Array.isArray(body?.allocations)
  )
    return NextResponse.json(
      { error: "Neplatná revize nebo přiřazení." },
      { status: 400 },
    );
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel." },
      { status: 401 },
    );
  if (
    !canManageInvoices(identity.membership.role) ||
    !canUseGpcImport(identity.membership.role)
  )
    return NextResponse.json(
      { error: "Nemáte oprávnění měnit návrh." },
      { status: 403 },
    );
  const { data, error } = await identity.service.rpc(
    "save_bank_statement_allocations",
    {
      target_org: identity.membership.organization_id,
      actor_user: identity.user.id,
      target_import: id,
      expected_revision: Number(body?.revision),
      reviewed_entries: body?.reviewed_entry_ids as Json,
      allocation_rows: body?.allocations as Json,
    },
  );
  if (error)
    return NextResponse.json(
      {
        error: error.message.includes("revision_conflict")
          ? "Návrh mezitím změnil jiný uživatel. Načtěte jej znovu."
          : "Návrh se nepodařilo uložit.",
      },
      { status: error.message.includes("revision_conflict") ? 409 : 400 },
    );
  return NextResponse.json(data);
}
