import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { sendReminderEmail } from "@/lib/email";
import { buildReminderSchedule, compareDate, hasReminderAttemptBudget, isLatestEligibleReminder, MAX_MANUAL_REMINDER_ATTEMPTS, todayInTimeZone } from "@/lib/reminders";
import { isSameOriginMutation } from "@/lib/request-security";
import { isDemoMode, nullableRpcString } from "@/lib/supabase-server";
import { INVOICE_REMINDER_POLICY_STATE_SELECT, reminderDatabaseError } from "@/lib/reminder-automation-query";
import type { Invoice, ReminderStage } from "@/types/invoice";

const DEFAULT_THRESHOLDS = [-3, 0, 7, 14];
const atCronTime = (date: string) => `${date}T06:00:00.000Z`;
type Context = { params: Promise<{ id: string; reminderId: string }> };

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  }
  const { id, reminderId } = await params;
  if (isDemoMode()) {
    return NextResponse.json({
      reminder: { id: reminderId, status: "sent", sent_at: new Date().toISOString(), attempt_count: 2, error_message: null },
      invoice: { id, reminders_sent: 3 },
    });
  }

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) {
    return NextResponse.json({ error: "Nemáte oprávnění upomínku odeslat." }, { status: 403 });
  }

  const organizationId = identity.membership.organization_id;
  const { data: log, error: logError } = await identity.service.from("reminder_log")
    .select("id, invoice_id, stage, scheduled_for, status, attempt_count, error_message")
    .eq("id", reminderId).eq("invoice_id", id).eq("organization_id", organizationId).maybeSingle();
  if (logError) return NextResponse.json({ error: "Upomínku se nepodařilo načíst." }, { status: 500 });
  if (!log) return NextResponse.json({ error: "Upomínka nebyla nalezena." }, { status: 404 });
  if (log.status !== "failed") {
    return NextResponse.json({ error: "Znovu lze odeslat pouze neúspěšnou upomínku." }, { status: 409 });
  }
  if (!hasReminderAttemptBudget({ ...log, status: "failed" }, MAX_MANUAL_REMINDER_ATTEMPTS)) {
    return NextResponse.json({ error: "Upomínka už vyčerpala bezpečný limit pokusů. Zkontrolujte adresu a kontaktujte odběratele jiným způsobem." }, { status: 409 });
  }

  const { data: invoice, error: invoiceError } = await identity.service.from("invoices").select("*")
    .eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (invoiceError) return NextResponse.json({ error: "Fakturu se nepodařilo načíst." }, { status: 500 });
  if (!invoice) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });
  if (!['pending', 'overdue'].includes(invoice.status)) {
    return NextResponse.json({ error: "U zaplacené nebo stornované faktury nelze upomínku odeslat." }, { status: 409 });
  }
  if (invoice.reminders_paused) {
    return NextResponse.json({ error: "Nejprve u této faktury znovu zapněte automatické upomínky." }, { status: 409 });
  }
  const { data: suppression, error: suppressionError } = await identity.service.from("email_suppressions")
    .select("reason").eq("organization_id", organizationId)
    .eq("email", invoice.counterparty_email.toLowerCase()).maybeSingle();
  if (suppressionError) return NextResponse.json({ error: "Stav e-mailové adresy se nepodařilo ověřit." }, { status: 500 });
  if (suppression) {
    return NextResponse.json({ error: "Na tuto adresu nelze odesílat. Opravte kontaktní e-mail odběratele a zkuste to znovu." }, { status: 409 });
  }

  let policyQuery = identity.service.from("reminder_policies").select("days_from_due, is_active")
    .eq("organization_id", organizationId);
  policyQuery = invoice.reminder_policy_id
    ? policyQuery.eq("id", invoice.reminder_policy_id)
    : policyQuery.eq("is_default", true);
  const { data: policy, error: policyError } = await policyQuery.maybeSingle();
  if (policyError) return NextResponse.json({ error: "Nastavení upomínek se nepodařilo ověřit." }, { status: 500 });
  if (policy?.is_active === false) {
    return NextResponse.json({ error: "Automatické upomínky jsou pro celou firmu pozastavené." }, { status: 409 });
  }

  const today = todayInTimeZone();
  const schedule = buildReminderSchedule(invoice.due_date, policy?.days_from_due ?? DEFAULT_THRESHOLDS);
  if (!isLatestEligibleReminder(schedule, today, log.scheduled_for, log.stage as ReminderStage)) {
    return NextResponse.json({ error: "Tato upomínka už neodpovídá aktuálnímu plánu. Vyčkejte na další naplánovaný krok." }, { status: 409 });
  }
  const nextFuture = schedule.find(item => compareDate(item.scheduledFor, today) > 0) ?? null;
  const { data: template, error: templateError } = await identity.service.from("email_templates")
    .select("subject, body, reply_to, cc").eq("organization_id", organizationId)
    .eq("stage", log.stage).maybeSingle();
  if (templateError) return NextResponse.json({ error: "E-mailovou šablonu se nepodařilo načíst." }, { status: 500 });

  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await identity.service.from("reminder_log").update({
    status: "queued",
    attempt_count: (log.attempt_count ?? 0) + 1,
    sent_to: invoice.counterparty_email,
    error_message: null,
    updated_at: claimedAt,
  }).eq("id", reminderId).eq("status", "failed").select("id, attempt_count").maybeSingle();
  if (claimError) return NextResponse.json({ error: "Nový pokus se nepodařilo bezpečně zařadit." }, { status: 500 });
  if (!claimed) return NextResponse.json({ error: "Upomínku už zpracovává jiný požadavek." }, { status: 409 });

  const { data: currentInvoice, error: currentInvoiceError } = await identity.service.from("invoices").select(INVOICE_REMINDER_POLICY_STATE_SELECT)
    .eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (currentInvoiceError) {
    const failure = reminderDatabaseError(`Opětovné ověření faktury ${invoice.invoice_number}`, currentInvoiceError);
    console.error("[reminder-retry] invoice recheck failed", failure);
    await identity.service.from("reminder_log").update({ status: "failed", error_message: failure, updated_at: new Date().toISOString() })
      .eq("id", reminderId).eq("status", "queued");
    return NextResponse.json({ error: "Fakturu se nepodařilo znovu ověřit. Pokus zůstal připravený k opakování.", code: "REMINDER_INVOICE_RECHECK_FAILED" }, { status: 500 });
  }
  if (!currentInvoice || !["pending", "overdue"].includes(currentInvoice.status) || currentInvoice.due_date !== invoice.due_date) {
    await identity.service.from("reminder_log").update({ status: "skipped", error_message: null, updated_at: new Date().toISOString() })
      .eq("id", reminderId).eq("status", "queued");
    return NextResponse.json({ error: "Faktura se mezitím změnila; upomínka nebyla odeslána." }, { status: 409 });
  }
  if (currentInvoice.reminders_paused || currentInvoice.reminder_policy?.is_active === false) {
    await identity.service.from("reminder_log").update({ status: "failed", error_message: log.error_message, updated_at: new Date().toISOString() })
      .eq("id", reminderId).eq("status", "queued");
    return NextResponse.json({ error: "Upomínky byly mezitím pozastavené; e-mail nebyl odeslán." }, { status: 409 });
  }
  const { data: currentSuppression, error: currentSuppressionError } = await identity.service.from("email_suppressions")
    .select("reason").eq("organization_id", organizationId)
    .eq("email", currentInvoice.counterparty_email.toLowerCase()).maybeSingle();
  if (currentSuppressionError || currentSuppression) {
    await identity.service.from("reminder_log").update({ status: "failed", error_message: log.error_message, updated_at: new Date().toISOString() })
      .eq("id", reminderId).eq("status", "queued");
    return NextResponse.json({ error: currentSuppressionError ? "Stav e-mailové adresy se mezitím nepodařilo ověřit." : "E-mailová adresa byla mezitím zablokována; zpráva nebyla odeslána." }, { status: currentSuppressionError ? 500 : 409 });
  }

  try {
    const result = await sendReminderEmail({
      to: currentInvoice.counterparty_email,
      invoice: currentInvoice as Invoice,
      stage: log.stage as ReminderStage,
      idempotencyKey: `reminder-${reminderId}`,
      template,
    });
    if (result.error) throw new Error(result.error.message);
    const sentAt = new Date().toISOString();
    const { data: completed, error: completionError } = await identity.service.rpc("complete_reminder_send", {
      target_log_id: reminderId,
      provider_id: result.data?.id ?? null,
      sent_time: sentAt,
      next_time: nullableRpcString(nextFuture ? atCronTime(nextFuture.scheduledFor) : null),
    });
    if (completionError || !completed) throw new Error("Odeslání se nepodařilo potvrdit v databázi.");
    return NextResponse.json({
      reminder: { id: reminderId, status: "sent", sent_at: sentAt, attempt_count: claimed.attempt_count, error_message: null },
      invoice: { id, reminders_sent: Number(currentInvoice.reminders_sent) + 1, last_reminder_at: sentAt, next_reminder_at: nextFuture ? atCronTime(nextFuture.scheduledFor) : null },
    });
  } catch (cause) {
    const failedAt = new Date().toISOString();
    await identity.service.from("reminder_log").update({
      status: "failed",
      error_message: cause instanceof Error ? cause.message.slice(0, 1000) : "Neznámá chyba",
      updated_at: failedAt,
    }).eq("id", reminderId).eq("status", "queued");
    return NextResponse.json({ error: "E-mail se nepodařilo odeslat. Pokus zůstal bezpečně uložený v historii." }, { status: 502 });
  }
}
