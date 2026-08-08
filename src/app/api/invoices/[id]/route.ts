import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { demoInvoices } from "@/lib/demo-data";
import { parseInvoiceInput } from "@/lib/invoice-validation";
import { initialNextReminderAt, todayInTimeZone } from "@/lib/reminders";
import { parsePaymentDate, paymentDateToTimestamp } from "@/lib/payment-validation";
import { requiresAtomicPaymentReopen } from "@/lib/payment-lifecycle";
import { isSameOriginMutation } from "@/lib/request-security";
import { isDemoMode } from "@/lib/supabase-server";
import type { Invoice, InvoiceStatus } from "@/types/invoice";

type Context = { params: Promise<{ id: string }> };
const allowedStatus: InvoiceStatus[] = ["pending", "paid", "overdue", "cancelled"];
const editableFields = ["invoice_number", "counterparty_name", "counterparty_ico", "counterparty_dic", "counterparty_email", "variable_symbol", "amount_without_vat", "vat_rate", "amount", "currency", "issue_date", "due_date", "notes"] as const;

function demoInvoice(id: string) {
  return demoInvoices.find((invoice) => invoice.id === id) ?? null;
}

export async function GET(_: Request, { params }: Context) {
  const { id } = await params;
  if (isDemoMode()) {
    const invoice = demoInvoice(id);
    return invoice
      ? NextResponse.json({ invoice, document_url: null, payments: [], can_manage: true })
      : NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });
  }
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });

  const { data, error } = await identity.service.from("invoices").select("*")
    .eq("id", id).eq("organization_id", identity.membership.organization_id).maybeSingle();
  if (error) return NextResponse.json({ error: "Fakturu se nepodařilo načíst." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });
  const { data: payments } = await identity.service.from("bank_payments")
    .select("id, external_id, booked_on, amount, currency, variable_symbol, counterparty_name, counterparty_account, note, matched_at")
    .eq("organization_id", identity.membership.organization_id).eq("invoice_id", id)
    .order("booked_on", { ascending: false });
  let documentUrl: string | null = null;
  if (data.file_url) {
    const { data: signed } = await identity.service.storage.from("invoice-documents").createSignedUrl(data.file_url, 300);
    documentUrl = signed?.signedUrl ?? null;
  }
  return NextResponse.json({ invoice: data, document_url: documentUrl, payments: payments ?? [], can_manage: canManageInvoices(identity.membership.role) });
}

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Array.isArray(body)) return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  if ("status" in body && (typeof body.status !== "string" || !allowedStatus.includes(body.status as InvoiceStatus))) {
    return NextResponse.json({ error: "Neplatný stav faktury." }, { status: 400 });
  }
  if ("reminders_paused" in body && typeof body.reminders_paused !== "boolean") {
    return NextResponse.json({ error: "Neplatné nastavení automatických upomínek." }, { status: 400 });
  }

  const demo = isDemoMode();
  const identity = demo ? null : await getRequestIdentity();
  if (!demo && !identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (identity && !canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění fakturu upravit." }, { status: 403 });

  let existing: Invoice | null = demo ? demoInvoice(id) : null;
  if (identity) {
    const { data, error } = await identity.service.from("invoices").select("*")
      .eq("id", id).eq("organization_id", identity.membership.organization_id).maybeSingle();
    if (error) return NextResponse.json({ error: "Fakturu se nepodařilo načíst." }, { status: 500 });
    existing = data as Invoice | null;
  }
  if (!existing) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });

  const merged = { ...existing } as Record<string, unknown>;
  for (const key of editableFields) if (key in body) merged[key] = body[key];
  const input = parseInvoiceInput(merged);
  if (!input) return NextResponse.json({ error: "Zkontrolujte povinné údaje, částku, měnu, e-mail a data faktury." }, { status: 400 });
  if (Number(existing.paid_amount) > 0 && input.currency !== existing.currency) {
    return NextResponse.json({ error: "Měnu faktury s evidovanou úhradou nelze změnit. Nejprve uvolněte přiřazené platby." }, { status: 409 });
  }
  if (Number(input.amount) < Number(existing.paid_amount)) {
    return NextResponse.json({ error: "Částka faktury nesmí být nižší než již evidovaná úhrada." }, { status: 409 });
  }

  const today = todayInTimeZone();
  const requestedStatus = (body.status as InvoiceStatus | undefined) ?? existing.status;
  const status: InvoiceStatus = requestedStatus === "paid" || requestedStatus === "cancelled"
    ? requestedStatus
    : input.due_date < today ? "overdue" : "pending";
  const remindersPaused = (body.reminders_paused as boolean | undefined) ?? existing.reminders_paused ?? false;
  const requestedPaidOn = "paid_on" in body ? parsePaymentDate(body.paid_on, today) : null;
  if ("paid_on" in body && !requestedPaidOn) {
    return NextResponse.json({ error: "Datum úhrady musí být platné a nesmí být v budoucnosti." }, { status: 400 });
  }
  let nextReminderAt: string | null = null;
  if (!remindersPaused && (status === "pending" || status === "overdue")) {
    let thresholds = [-3, 0, 7, 14];
    if (identity) {
      let policyQuery = identity.service.from("reminder_policies").select("days_from_due, is_active")
        .eq("organization_id", identity.membership.organization_id);
      policyQuery = existing.reminder_policy_id
        ? policyQuery.eq("id", existing.reminder_policy_id)
        : policyQuery.eq("is_default", true);
      const { data: policy } = await policyQuery.maybeSingle();
      if (policy?.is_active === false) thresholds = [];
      else if (policy?.days_from_due) thresholds = policy.days_from_due;
    }
    nextReminderAt = thresholds.length ? initialNextReminderAt(input.due_date, thresholds, today) : null;
  }

  if (existing.status === "paid" && status === "cancelled") {
    return NextResponse.json({ error: "Zaplacenou fakturu nejprve vraťte mezi neuhrazené. Tím se bezpečně uvolní případná bankovní platba." }, { status: 409 });
  }
  if (status === "cancelled" && Number(existing.paid_amount) > 0) {
    return NextResponse.json({ error: "Fakturu s částečnou úhradou nelze stornovat. Nejprve uvolněte její bankovní platby." }, { status: 409 });
  }
  if (identity && requiresAtomicPaymentReopen(existing.status, status)) {
    const combinedChange = editableFields.some(key => key in body) || "paid_on" in body || "reminders_paused" in body;
    if (combinedChange) return NextResponse.json({ error: "Vrácení uhrazené faktury proveďte samostatně před dalšími úpravami." }, { status: 400 });
    const { data: reopened, error: reopenError } = await identity.service.rpc("reopen_paid_invoice", {
      target_org: identity.membership.organization_id,
      target_invoice: id,
      actor_user: identity.user.id,
      new_status: status,
      next_time: nextReminderAt,
    });
    if (reopenError) {
      if (reopenError.message.includes("invoice_not_found")) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });
      if (reopenError.message.includes("invoice_not_paid")) return NextResponse.json({ error: "Stav faktury se mezitím změnil. Načtěte stránku znovu." }, { status: 409 });
      return NextResponse.json({ error: "Fakturu se nepodařilo bezpečně znovu otevřít. Zkontrolujte databázovou migraci plateb." }, { status: 500 });
    }
    const result = reopened as { invoice?: Invoice; detached_payments?: number } | null;
    if (!result?.invoice) return NextResponse.json({ error: "Fakturu se nepodařilo znovu načíst." }, { status: 500 });
    return NextResponse.json({ invoice: result.invoice, detached_payments: result.detached_payments ?? 0 });
  }

  const changes = {
    ...input,
    counterparty_ico: input.counterparty_ico ?? null,
    counterparty_dic: input.counterparty_dic ?? null,
    variable_symbol: input.variable_symbol ?? null,
    notes: input.notes ?? null,
    file_url: existing.file_url,
    source: existing.source,
    status,
    paid_amount: status === "paid" ? Number(input.amount) : status === "cancelled" ? 0 : Number(existing.paid_amount),
    paid_at: status === "paid"
      ? paymentDateToTimestamp(requestedPaidOn ?? existing.paid_at?.slice(0, 10) ?? today)
      : null,
    next_reminder_at: nextReminderAt,
    reminders_paused: remindersPaused,
    reminders_paused_at: remindersPaused ? existing.reminders_paused_at ?? new Date().toISOString() : null,
    reminders_paused_by: remindersPaused ? existing.reminders_paused_by ?? identity?.user.id ?? null : null,
    updated_by: identity?.user.id ?? null,
    updated_at: new Date().toISOString(),
  };

  if (demo) return NextResponse.json({ invoice: { ...existing, ...changes, id } });

  const { data, error } = await identity!.service.from("invoices").update(changes).eq("id", id)
    .eq("organization_id", identity!.membership.organization_id).select("*").maybeSingle();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Faktura s tímto číslem už existuje." : "Fakturu se nepodařilo uložit." }, { status: error.code === "23505" ? 409 : 500 });
  if (!data) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });

  if ((status === "paid" || status === "cancelled") || input.due_date !== existing.due_date) {
    await identity!.service.from("reminder_log").update({ status: "skipped", error_message: null, updated_at: changes.updated_at })
      .eq("invoice_id", id).in("status", ["queued", "failed"]);
  }
  return NextResponse.json({ invoice: data });
}

export async function DELETE(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const { id } = await params;
  if (isDemoMode()) return NextResponse.json({ deleted: true });

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění fakturu smazat." }, { status: 403 });

  const organizationId = identity.membership.organization_id;
  const { data: existing, error: lookupError } = await identity.service.from("invoices")
    .select("id, file_url").eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Fakturu se nepodařilo ověřit." }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });

  const { data: deleted, error: deleteError } = await identity.service.rpc("delete_invoice_safely", {
    target_org: organizationId,
    target_invoice: id,
    actor_user: identity.user.id,
  });
  if (deleteError) {
    if (deleteError.message.includes("invoice_not_found")) return NextResponse.json({ error: "Faktura již neexistuje." }, { status: 404 });
    if (deleteError.message.includes("insufficient_permission")) return NextResponse.json({ error: "Nemáte oprávnění fakturu smazat." }, { status: 403 });
    return NextResponse.json({ error: "Fakturu se nepodařilo bezpečně smazat. Zkontrolujte poslední databázovou migraci." }, { status: 500 });
  }

  let documentCleanupPending = false;
  if (existing.file_url) {
    const { error: storageError } = await identity.service.storage.from("invoice-documents").remove([existing.file_url]);
    documentCleanupPending = Boolean(storageError);
    if (!storageError) {
      await identity.service.from("invoice_uploads").delete()
        .eq("organization_id", organizationId).eq("path", existing.file_url).is("invoice_id", null);
    }
  }

  return NextResponse.json({ deleted: true, document_cleanup_pending: documentCleanupPending, result: deleted });
}
