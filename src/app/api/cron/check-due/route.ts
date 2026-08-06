import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { createServiceClient, isDemoMode } from "@/lib/supabase-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { sendReminderEmail } from "@/lib/email";
import {
  AUTOMATION_RUN_STALE_MINUTES,
  completedAutomationRunStatus,
  emptyAutomationRunCounters,
  manualAutomationRunBlock,
  type AutomationRun,
  type AutomationRunCounters,
  type AutomationRunStatus,
} from "@/lib/automation-run";
import {
  buildReminderSchedule,
  decideReminderAction,
  hasReminderAttemptBudget,
  MAX_AUTOMATIC_REMINDER_ATTEMPTS,
  REMINDER_LEASE_MINUTES,
  todayInTimeZone,
  type ExistingReminderLog,
} from "@/lib/reminders";
import type { Invoice } from "@/types/invoice";

const DEFAULT_THRESHOLDS = [-3, 0, 7, 14];
const atCronTime = (date: string) => `${date}T06:00:00.000Z`;

async function executeReminderAutomation(targetOrganizationId?: string, manualTrigger?: { userId: string; email: string }) {
  const db = createServiceClient();
  const today = todayInTimeZone();
  const runKey = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let organizationsQuery = db.from("organizations").select("id");
  if (targetOrganizationId) organizationsQuery = organizationsQuery.eq("id", targetOrganizationId);
  const { data: organizations, error: organizationsError } = await organizationsQuery;
  if (organizationsError) return NextResponse.json({ error: "Organizace se nepodařilo načíst." }, { status: 500 });

  const organizationCounters = new Map<string, AutomationRunCounters>();
  const incrementOrganization = (organizationId: string, field: keyof AutomationRunCounters, amount = 1) => {
    const counters = organizationCounters.get(organizationId);
    if (counters) counters[field] += amount;
  };
  let staleRunsQuery = db.from("reminder_automation_runs").update({
    status: "failed",
    finished_at: startedAt,
    error_message: "Předchozí běh nebyl dokončen v časovém limitu.",
  }).eq("status", "running").lte("started_at", new Date(Date.parse(startedAt) - AUTOMATION_RUN_STALE_MINUTES * 60_000).toISOString());
  if (targetOrganizationId) staleRunsQuery = staleRunsQuery.eq("organization_id", targetOrganizationId);
  const { error: staleRunsError } = await staleRunsQuery;
  if (staleRunsError) return NextResponse.json({ error: "Nedokončené běhy automatu se nepodařilo uzavřít." }, { status: 500 });
  const finishRuns = async (forcedStatus?: Extract<AutomationRunStatus, "failed">, errorMessage?: string) => {
    const finishedAt = new Date().toISOString();
    const results = await Promise.all([...organizationCounters].map(([organizationId, counters]) => db
      .from("reminder_automation_runs")
      .update({
        ...counters,
        status: forcedStatus ?? completedAutomationRunStatus(counters),
        error_message: errorMessage?.slice(0, 1000) ?? null,
        finished_at: finishedAt,
      })
      .eq("organization_id", organizationId)
      .eq("run_key", runKey)
      .eq("status", "running")));
    return results.every(result => !result.error);
  };
  let busyOrganizations = 0;
  for (const organization of organizations ?? []) {
    const { error: startError } = await db.from("reminder_automation_runs").insert({
      organization_id: organization.id,
      run_key: runKey,
      trigger_source: manualTrigger ? "manual" : "scheduled",
      triggered_by: manualTrigger?.userId ?? null,
      triggered_by_email: manualTrigger?.email ?? null,
      status: "running",
      started_at: startedAt,
    });
    if (startError?.code === "23505") {
      busyOrganizations++;
      if (targetOrganizationId) return NextResponse.json({ error: "Kontrola upomínek už právě probíhá." }, { status: 409 });
      continue;
    }
    if (startError) {
      await finishRuns("failed", "Další provozní záznam automatu se nepodařilo založit.");
      return NextResponse.json({ error: "Provozní záznam automatu se nepodařilo založit. Zkontrolujte databázové migrace." }, { status: 500 });
    }
    organizationCounters.set(organization.id, emptyAutomationRunCounters());
  }
  const startedOrganizationIds = [...organizationCounters.keys()];
  if (!startedOrganizationIds.length) return NextResponse.json({ checked: 0, sent: 0, failed: 0, skipped: 0, disabled: 0, paused: 0, suppressed: 0, exhausted: 0, busy_organizations: busyOrganizations });

  const { data: expiredUploads, error: expiredUploadsError } = await db.from("invoice_uploads").select("id, path")
    .in("organization_id", startedOrganizationIds).in("status", ["pending", "verified"])
    .lt("expires_at", new Date().toISOString()).limit(100);
  if (expiredUploadsError) {
    await finishRuns("failed", "Dočasné OCR soubory se nepodařilo načíst.");
    return NextResponse.json({ error: "Dočasné OCR soubory se nepodařilo načíst." }, { status: 500 });
  }
  if (expiredUploads?.length) {
    const paths = expiredUploads.map(upload => upload.path);
    const { data: attachedInvoices, error: attachedInvoicesError } = await db.from("invoices").select("id, file_url")
      .in("organization_id", startedOrganizationIds).in("file_url", paths);
    if (attachedInvoicesError) {
      await finishRuns("failed", "Vazby OCR souborů se nepodařilo ověřit.");
      return NextResponse.json({ error: "Vazby OCR souborů se nepodařilo ověřit." }, { status: 500 });
    }
    const attachedByPath = new Map((attachedInvoices ?? []).map(invoice => [invoice.file_url, invoice.id]));
    for (const upload of expiredUploads) {
      const invoiceId = attachedByPath.get(upload.path);
      if (invoiceId) {
        const { error } = await db.from("invoice_uploads").update({ status: "claimed", invoice_id: invoiceId }).eq("id", upload.id);
        if (error) {
          await finishRuns("failed", "OCR soubor se nepodařilo označit jako připojený.");
          return NextResponse.json({ error: "OCR soubor se nepodařilo označit jako připojený." }, { status: 500 });
        }
      } else {
        const { error: storageError } = await db.storage.from("invoice-documents").remove([upload.path]);
        if (storageError) {
          await finishRuns("failed", "Prošlý OCR soubor se nepodařilo odstranit z úložiště.");
          return NextResponse.json({ error: "Prošlý OCR soubor se nepodařilo odstranit z úložiště." }, { status: 500 });
        }
        const { error: deleteError } = await db.from("invoice_uploads").delete().eq("id", upload.id);
        if (deleteError) {
          await finishRuns("failed", "Záznam prošlého OCR souboru se nepodařilo odstranit.");
          return NextResponse.json({ error: "Záznam prošlého OCR souboru se nepodařilo odstranit." }, { status: 500 });
        }
      }
    }
  }
  const invoices: (Invoice & { reminder_policies?: { days_from_due: number[]; is_active: boolean } | null })[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let invoiceQuery = db
      .from("invoices")
      .select("*, reminder_policies(days_from_due, is_active)")
      .in("status", ["pending", "overdue"]);
    invoiceQuery = invoiceQuery.in("organization_id", startedOrganizationIds);
    const { data, error } = await invoiceQuery
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) {
      await finishRuns("failed", "Faktury se nepodařilo načíst.");
      return NextResponse.json({ error: "Faktury se nepodařilo načíst." }, { status: 500 });
    }
    invoices.push(...((data ?? []) as typeof invoices));
    if (!data || data.length < pageSize) break;
  }

  const suppressedRecipients = new Set<string>();
  for (let offset = 0; ; offset += pageSize) {
    let suppressionsQuery = db.from("email_suppressions").select("organization_id, email");
    suppressionsQuery = suppressionsQuery.in("organization_id", startedOrganizationIds);
    const { data, error } = await suppressionsQuery
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) {
      await finishRuns("failed", "Seznam blokovaných e-mailů se nepodařilo načíst.");
      return NextResponse.json({ error: "Seznam blokovaných e-mailů se nepodařilo načíst." }, { status: 500 });
    }
    for (const item of data ?? []) suppressedRecipients.add(`${item.organization_id}\0${item.email.toLowerCase()}`);
    if (!data || data.length < pageSize) break;
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let disabled = 0;
  let paused = 0;
  let suppressed = 0;
  let exhausted = 0;
  const recordFailure = (organizationId: string) => {
    failed++;
    incrementOrganization(organizationId, "failed");
  };

  for (const invoice of invoices) {
    incrementOrganization(invoice.organization_id, "checked");
    if (invoice.reminders_paused) {
      if (invoice.next_reminder_at) await db.from("invoices").update({ next_reminder_at: null }).eq("id", invoice.id);
      paused++;
      incrementOrganization(invoice.organization_id, "paused");
      continue;
    }
    if (suppressedRecipients.has(`${invoice.organization_id}\0${invoice.counterparty_email.toLowerCase()}`)) {
      if (invoice.next_reminder_at) await db.from("invoices").update({ next_reminder_at: null }).eq("id", invoice.id);
      suppressed++;
      incrementOrganization(invoice.organization_id, "suppressed");
      continue;
    }
    if (invoice.reminder_policies?.is_active === false) {
      await db.from("invoices").update({ next_reminder_at: null }).eq("id", invoice.id);
      disabled++;
      incrementOrganization(invoice.organization_id, "disabled");
      continue;
    }

    const thresholds = invoice.reminder_policies?.days_from_due ?? DEFAULT_THRESHOLDS;
    const schedule = buildReminderSchedule(invoice.due_date, thresholds);
    const { data: rawLogs, error: logsError } = await db
      .from("reminder_log")
      .select("id, scheduled_for, status, attempt_count, updated_at")
      .eq("invoice_id", invoice.id);
    if (logsError) {
      recordFailure(invoice.organization_id);
      continue;
    }
    const logs = (rawLogs ?? []) as (ExistingReminderLog & { attempt_count: number })[];
    const now = new Date();
    const decision = decideReminderAction(schedule, today, logs, now);

    if (invoice.due_date < today && invoice.status === "pending") {
      const { error: overdueError } = await db.from("invoices").update({ status: "overdue", updated_by: null, updated_at: new Date().toISOString() }).eq("id", invoice.id);
      if (overdueError) recordFailure(invoice.organization_id);
    }

    // Starší zmeškané fáze se auditně označí jako přeskočené. Jeden běh tak
    // nikdy nepošle klientovi několik historických zpráv současně.
    for (const obsolete of decision.obsolete) {
      const existing = logs.find(log => log.scheduled_for === obsolete.scheduledFor);
      if (existing) {
        await db.from("reminder_log").update({ status: "skipped", error_message: null, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        await db.from("reminder_log").insert({
          organization_id: invoice.organization_id,
          invoice_id: invoice.id,
          stage: obsolete.stage,
          scheduled_for: obsolete.scheduledFor,
          sent_to: invoice.counterparty_email,
          status: "skipped",
        });
      }
      skipped++;
      incrementOrganization(invoice.organization_id, "skipped");
    }

    const candidate = decision.candidate;
    if (!candidate) {
      await db.from("invoices").update({
        next_reminder_at: decision.nextFuture ? atCronTime(decision.nextFuture.scheduledFor) : null,
        updated_at: new Date().toISOString(),
      }).eq("id", invoice.id);
      continue;
    }

    const existing = logs.find(log => log.scheduled_for === candidate.scheduledFor);
    if (existing?.status === "failed" && !hasReminderAttemptBudget(existing, MAX_AUTOMATIC_REMINDER_ATTEMPTS)) {
      await db.from("invoices").update({
        next_reminder_at: decision.nextFuture ? atCronTime(decision.nextFuture.scheduledFor) : null,
        updated_at: new Date().toISOString(),
      }).eq("id", invoice.id);
      exhausted++;
      incrementOrganization(invoice.organization_id, "exhausted");
      continue;
    }

    const { data: template, error: templateError } = await db
      .from("email_templates")
      .select("subject, body, reply_to, cc")
      .eq("organization_id", invoice.organization_id)
      .eq("stage", candidate.stage)
      .maybeSingle();
    if (templateError) {
      recordFailure(invoice.organization_id);
      continue;
    }

    let logId: string | null = existing?.id ?? null;
    if (existing) {
      let claim = db.from("reminder_log").update({
        status: "queued",
        attempt_count: (existing.attempt_count ?? 0) + 1,
        sent_to: invoice.counterparty_email,
        error_message: null,
        updated_at: now.toISOString(),
      }).eq("id", existing.id);
      claim = existing.status === "failed"
        ? claim.eq("status", "failed")
        : claim.eq("status", "queued").lte("updated_at", new Date(now.getTime() - REMINDER_LEASE_MINUTES * 60_000).toISOString());
      const { data: claimed, error: queueError } = await claim.select("id").maybeSingle();
      if (queueError) {
        recordFailure(invoice.organization_id);
        continue;
      }
      if (!claimed) continue;
      logId = claimed.id;
    } else {
      const { data: log, error: insertError } = await db.from("reminder_log").insert({
        organization_id: invoice.organization_id,
        invoice_id: invoice.id,
        stage: candidate.stage,
        scheduled_for: candidate.scheduledFor,
        sent_to: invoice.counterparty_email,
        status: "queued",
        attempt_count: 1,
      }).select("id").single();
      if (insertError) {
        if (insertError.code !== "23505") {
          recordFailure(invoice.organization_id);
        }
        continue; // Souběžný cron mohl získat unikátní zámek.
      }
      if (!log) continue;
      logId = log.id;
    }
    if (!logId) continue;

    const { data: currentInvoice, error: currentInvoiceError } = await db.from("invoices").select("*, reminder_policies(is_active)").eq("id", invoice.id).maybeSingle();
    if (currentInvoiceError) {
      await db.from("reminder_log").update({ status: "failed", error_message: "Fakturu se nepodařilo znovu ověřit.", updated_at: new Date().toISOString() }).eq("id", logId).eq("status", "queued");
      recordFailure(invoice.organization_id);
      continue;
    }
    if (!currentInvoice || !["pending", "overdue"].includes(currentInvoice.status) || currentInvoice.due_date !== invoice.due_date || currentInvoice.reminders_paused || currentInvoice.reminder_policies?.is_active === false) {
      await db.from("reminder_log").update({ status: "skipped", error_message: null, updated_at: new Date().toISOString() })
        .eq("id", logId).eq("status", "queued");
      skipped++;
      incrementOrganization(invoice.organization_id, "skipped");
      continue;
    }
    const { data: recipientUpdated, error: recipientUpdateError } = await db.from("reminder_log").update({ sent_to: currentInvoice.counterparty_email })
      .eq("id", logId).eq("status", "queued").select("id").maybeSingle();
    if (recipientUpdateError || !recipientUpdated) {
      await db.from("reminder_log").update({ status: "failed", error_message: "Příjemce upomínky se nepodařil potvrdit.", updated_at: new Date().toISOString() }).eq("id", logId).eq("status", "queued");
      if (recipientUpdateError) recordFailure(invoice.organization_id);
      continue;
    }

    try {
      const result = await sendReminderEmail({
        to: currentInvoice.counterparty_email,
        invoice: currentInvoice as Invoice,
        stage: candidate.stage,
        idempotencyKey: `reminder-${logId}`,
        template,
      });
      if (result.error) throw new Error(result.error.message);
      const sentAt = new Date().toISOString();
      const { data: completed, error: completionError } = await db.rpc("complete_reminder_send", {
        target_log_id: logId,
        provider_id: result.data?.id ?? null,
        sent_time: sentAt,
        next_time: decision.nextFuture ? atCronTime(decision.nextFuture.scheduledFor) : null,
      });
      if (completionError || !completed) throw new Error("Odeslání se nepodařilo potvrdit v databázi.");
      sent++;
      incrementOrganization(invoice.organization_id, "sent");
    } catch (cause) {
      const failedAt = new Date().toISOString();
      const { data: markedFailed } = await db.from("reminder_log").update({
        status: "failed",
        error_message: cause instanceof Error ? cause.message.slice(0, 1000) : "Neznámá chyba",
        updated_at: failedAt,
      }).eq("id", logId).eq("status", "queued").select("id").maybeSingle();
      recordFailure(invoice.organization_id);
      if (markedFailed) {
        await db.from("invoices").update({ next_reminder_at: atCronTime(today), updated_at: failedAt }).eq("id", invoice.id);
      }
    }
  }

  if (!(await finishRuns())) {
    return NextResponse.json({ error: "Výsledek automatu se nepodařilo uložit." }, { status: 500 });
  }
  return NextResponse.json({ checked: invoices.length, sent, failed, skipped, disabled, paused, suppressed, exhausted, busy_organizations: busyOrganizations });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return executeReminderAutomation();
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ checked: 4, sent: 0, failed: 0, skipped: 0, disabled: 0, paused: 0, suppressed: 0, exhausted: 0, busy_organizations: 0, demo: true });

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění spustit kontrolu upomínek." }, { status: 403 });

  const { data: latestRun, error: latestRunError } = await identity.service.from("reminder_automation_runs")
    .select("status, started_at")
    .eq("organization_id", identity.membership.organization_id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestRunError) return NextResponse.json({ error: "Stav automatu se nepodařilo ověřit." }, { status: 500 });
  const blocked = manualAutomationRunBlock(latestRun as Pick<AutomationRun, "status" | "started_at"> | null);
  if (blocked === "running") return NextResponse.json({ error: "Kontrola upomínek už právě probíhá." }, { status: 409 });
  if (blocked === "cooldown") return NextResponse.json({ error: "Kontrola právě skončila. Další lze spustit za jednu minutu." }, { status: 429 });

  return executeReminderAutomation(identity.membership.organization_id, { userId: identity.user.id, email: identity.membership.email });
}
