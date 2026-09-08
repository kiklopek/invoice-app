import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { createServiceClient, isDemoMode, nullableRpcString } from "@/lib/supabase-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { sendReminderEmail } from "@/lib/email";
import type { ReminderEmailCompany } from "@/lib/reminder-email-template";
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
  buildEffectiveReminderSchedule,
  decideReminderAction,
  isLatestEligibleReminder,
  MAX_AUTOMATIC_REMINDER_ATTEMPTS,
  todayInTimeZone,
  type ExistingReminderLog,
} from "@/lib/reminders";
import {
  INVOICE_REMINDER_POLICY_SELECT,
  INVOICE_REMINDER_POLICY_STATE_SELECT,
  reminderDatabaseError,
  type InvoiceReminderPolicy,
} from "@/lib/reminder-automation-query";
import type { Json } from "@/types/database";
import type { Invoice, ReminderStage } from "@/types/invoice";

const DEFAULT_THRESHOLDS = [-3, 0, 7, 14];
const PLANNER_INVOICE_LIMIT = 1000;
const WORKER_BATCH_LIMIT = 25;
const WORKER_MAX_RUNTIME_MS = 45_000;
const WORKER_LEASE_SECONDS = 15 * 60;
const HISTORY_BATCH_SIZE = 150;
const atCronTime = (date: string) => `${date}T06:00:00.000Z`;

type QueueJob = {
  organization_id: string;
  invoice_id: string;
  stage: ReminderStage;
  scheduled_for: string;
  sent_to: string;
  status: "queued" | "skipped";
  available_at: string;
};

type ClaimedJob = {
  id: string;
  organization_id: string;
  invoice_id: string;
  stage: ReminderStage;
  scheduled_for: string;
  attempt_count: number;
  lease_token: string;
};

type ReminderTemplate = { subject: string; body: string; reply_to: string | null; cc: string[] | null };

function totalCounters(counters: Map<string, AutomationRunCounters>) {
  const total = emptyAutomationRunCounters();
  for (const organization of counters.values()) {
    for (const key of Object.keys(total) as (keyof AutomationRunCounters)[]) total[key] += organization[key];
  }
  return total;
}

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
  const organizationErrors = new Map<string, string[]>();
  const incrementOrganization = (organizationId: string, field: keyof AutomationRunCounters, amount = 1) => {
    const counters = organizationCounters.get(organizationId);
    if (counters) counters[field] += amount;
  };
  const recordFailure = (organizationId: string, detail?: string) => {
    incrementOrganization(organizationId, "failed");
    if (!detail) return;
    const errors = organizationErrors.get(organizationId) ?? [];
    if (errors.length < 3) errors.push(detail);
    organizationErrors.set(organizationId, errors);
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
        error_message: (errorMessage ?? organizationErrors.get(organizationId)?.join(" | "))?.slice(0, 1000) ?? null,
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
  if (!startedOrganizationIds.length) return NextResponse.json({ ...emptyAutomationRunCounters(), busy_organizations: busyOrganizations });

  // OCR cleanup remains bounded and outside the reminder worker phase.
  const { data: expiredUploads, error: expiredUploadsError } = await db.from("invoice_uploads").select("id, path")
    .in("organization_id", startedOrganizationIds).in("status", ["pending", "verified"])
    .lt("expires_at", startedAt).limit(100);
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
    const unattached = expiredUploads.filter(upload => !attachedByPath.has(upload.path));
    const attached = expiredUploads.filter(upload => attachedByPath.has(upload.path));
    if (attached.length) {
      await Promise.all(attached.map(upload => db.from("invoice_uploads").update({
        status: "claimed",
        invoice_id: attachedByPath.get(upload.path),
      }).eq("id", upload.id)));
    }
    if (unattached.length) {
      const { error: storageError } = await db.storage.from("invoice-documents").remove(unattached.map(upload => upload.path));
      if (!storageError) await db.from("invoice_uploads").delete().in("id", unattached.map(upload => upload.id));
    }
  }

  const plannerStartedAt = Date.now();
  const { error: overdueError } = await db.from("invoices").update({
    status: "overdue",
    updated_by: null,
    updated_at: startedAt,
  }).in("organization_id", startedOrganizationIds).eq("status", "pending").lt("due_date", today);
  if (overdueError) {
    const failure = reminderDatabaseError("Hromadné označení faktur po splatnosti", overdueError);
    await finishRuns("failed", failure);
    return NextResponse.json({ error: "Faktury po splatnosti se nepodařilo aktualizovat." }, { status: 500 });
  }

  // Existing partial index (organization_id, next_reminder_at, id) matches this query.
  const { data: invoiceRows, error: invoicesError } = await db.from("invoices")
    .select(INVOICE_REMINDER_POLICY_SELECT)
    .in("organization_id", startedOrganizationIds)
    .in("status", ["pending", "overdue"])
    .not("next_reminder_at", "is", null)
    .lte("next_reminder_at", startedAt)
    .order("next_reminder_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(PLANNER_INVOICE_LIMIT);
  if (invoicesError) {
    const failure = reminderDatabaseError("Načtení splatných faktur pro automat", invoicesError);
    console.error("[reminder-automation] due invoice query failed", failure);
    await finishRuns("failed", failure);
    return NextResponse.json({ error: "Faktury se nepodařilo načíst.", code: "REMINDER_INVOICE_QUERY_FAILED" }, { status: 500 });
  }
  const invoices = (invoiceRows ?? []) as (Invoice & InvoiceReminderPolicy)[];

  const suppressedRecipients = new Set<string>();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("email_suppressions").select("organization_id, email")
      .in("organization_id", startedOrganizationIds).order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) {
      await finishRuns("failed", "Seznam blokovaných e-mailů se nepodařilo načíst.");
      return NextResponse.json({ error: "Seznam blokovaných e-mailů se nepodařilo načíst." }, { status: 500 });
    }
    for (const item of data ?? []) suppressedRecipients.add(`${item.organization_id}\0${item.email.toLowerCase()}`);
    if (!data || data.length < pageSize) break;
  }

  const logsByInvoice = new Map<string, (ExistingReminderLog & { attempt_count: number })[]>();
  const invoiceIds = invoices.map(invoice => invoice.id);
  for (let offset = 0; offset < invoiceIds.length; offset += HISTORY_BATCH_SIZE) {
    const { data, error } = await db.from("reminder_log")
      .select("id, invoice_id, scheduled_for, status, attempt_count, updated_at")
      .in("invoice_id", invoiceIds.slice(offset, offset + HISTORY_BATCH_SIZE));
    if (error) {
      const failure = reminderDatabaseError("Dávkové načtení historie upomínek", error);
      await finishRuns("failed", failure);
      return NextResponse.json({ error: "Historii upomínek se nepodařilo načíst." }, { status: 500 });
    }
    for (const log of data ?? []) {
      const logs = logsByInvoice.get(log.invoice_id) ?? [];
      logs.push(log as ExistingReminderLog & { attempt_count: number });
      logsByInvoice.set(log.invoice_id, logs);
    }
  }

  const queueJobs: QueueJob[] = [];
  const invoiceUpdates: { organization_id: string; invoice_id: string; next_reminder_at: string | null }[] = [];
  const plannerNow = new Date();
  for (const invoice of invoices) {
    incrementOrganization(invoice.organization_id, "checked");
    const suppressionKey = `${invoice.organization_id}\0${invoice.counterparty_email.toLowerCase()}`;
    if (invoice.reminders_paused) {
      incrementOrganization(invoice.organization_id, "paused");
      invoiceUpdates.push({ organization_id: invoice.organization_id, invoice_id: invoice.id, next_reminder_at: null });
      continue;
    }
    if (suppressedRecipients.has(suppressionKey)) {
      incrementOrganization(invoice.organization_id, "suppressed");
      invoiceUpdates.push({ organization_id: invoice.organization_id, invoice_id: invoice.id, next_reminder_at: null });
      continue;
    }
    if (invoice.reminder_policy?.is_active === false) {
      incrementOrganization(invoice.organization_id, "disabled");
      invoiceUpdates.push({ organization_id: invoice.organization_id, invoice_id: invoice.id, next_reminder_at: null });
      continue;
    }

    const schedule = buildEffectiveReminderSchedule(invoice.due_date, invoice.reminder_days_snapshot ?? DEFAULT_THRESHOLDS, invoice.reminder_plan_effective_from);
    const logs = logsByInvoice.get(invoice.id) ?? [];
    const decision = decideReminderAction(schedule, today, logs, plannerNow);
    for (const obsolete of decision.obsolete) {
      queueJobs.push({ organization_id: invoice.organization_id, invoice_id: invoice.id, stage: obsolete.stage,
        scheduled_for: obsolete.scheduledFor, sent_to: invoice.counterparty_email, status: "skipped", available_at: atCronTime(obsolete.scheduledFor) });
      incrementOrganization(invoice.organization_id, "skipped");
    }

    const candidate = decision.candidate;
    const existing = candidate ? logs.find(log => log.scheduled_for === candidate.scheduledFor) : undefined;
    if (candidate && existing?.status === "failed" && existing.attempt_count >= MAX_AUTOMATIC_REMINDER_ATTEMPTS) {
      incrementOrganization(invoice.organization_id, "exhausted");
    } else if (candidate && (!existing || existing.status === "failed")) {
      queueJobs.push({ organization_id: invoice.organization_id, invoice_id: invoice.id, stage: candidate.stage,
        scheduled_for: candidate.scheduledFor, sent_to: invoice.counterparty_email, status: "queued", available_at: atCronTime(candidate.scheduledFor) });
      incrementOrganization(invoice.organization_id, "queued");
    }
    invoiceUpdates.push({ organization_id: invoice.organization_id, invoice_id: invoice.id,
      next_reminder_at: decision.nextFuture ? atCronTime(decision.nextFuture.scheduledFor) : null });
  }

  const { error: scheduleError } = await db.rpc("schedule_reminder_jobs", {
    target_jobs: queueJobs as unknown as Json,
    target_invoice_updates: invoiceUpdates as unknown as Json,
    target_now: new Date().toISOString(),
  });
  if (scheduleError) {
    const failure = reminderDatabaseError("Atomické naplánování upomínek", scheduleError);
    await finishRuns("failed", failure);
    return NextResponse.json({ error: "Upomínky se nepodařilo zařadit do fronty. Zkontrolujte databázovou migraci." }, { status: 500 });
  }
  const plannerDurationMs = Date.now() - plannerStartedAt;
  for (const counters of organizationCounters.values()) counters.planner_duration_ms = plannerDurationMs;

  const workerStartedAt = Date.now();
  const workerToken = crypto.randomUUID();
  const { data: claimedRows, error: claimError } = await db.rpc("claim_reminder_jobs", {
    target_organizations: startedOrganizationIds,
    target_worker: workerToken,
    target_limit: WORKER_BATCH_LIMIT,
    target_lease_seconds: WORKER_LEASE_SECONDS,
    target_now: new Date().toISOString(),
  });
  if (claimError) {
    const failure = reminderDatabaseError("Převzetí dávky upomínek", claimError);
    await finishRuns("failed", failure);
    return NextResponse.json({ error: "Worker nemohl převzít frontu upomínek." }, { status: 500 });
  }
  const claimedJobs = (claimedRows ?? []) as ClaimedJob[];
  const claimedOrganizationIds = [...new Set(claimedJobs.map(job => job.organization_id))];
  const [templatesResult, companiesResult] = claimedOrganizationIds.length
    ? await Promise.all([
      db.from("email_templates").select("organization_id, stage, subject, body, reply_to, cc").in("organization_id", claimedOrganizationIds),
      db.from("organizations").select("id, name, ico, dic, registered_address, operating_address, phone, email, bank_account_czk, bank_account_eur").in("id", claimedOrganizationIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (templatesResult.error || companiesResult.error) {
    await db.rpc("release_claimed_reminder_jobs", {
      target_lease_token: workerToken,
      target_log_ids: claimedJobs.map(job => job.id),
      released_time: new Date().toISOString(),
    });
    const failure = "Šablony nebo firemní údaje pro worker se nepodařilo načíst dávkově.";
    await finishRuns("failed", failure);
    return NextResponse.json({ error: failure }, { status: 500 });
  }

  const templates = new Map<string, ReminderTemplate>();
  for (const template of templatesResult.data ?? []) templates.set(`${template.organization_id}\0${template.stage}`, {
    subject: template.subject, body: template.body, reply_to: template.reply_to, cc: template.cc,
  });
  const companies = new Map<string, ReminderEmailCompany>();
  for (const company of companiesResult.data ?? []) companies.set(company.id, company);

  let processedJobs = 0;
  for (const job of claimedJobs) {
    if (Date.now() - workerStartedAt >= WORKER_MAX_RUNTIME_MS) break;
    processedJobs++;
    incrementOrganization(job.organization_id, "processed");
    const { data: currentInvoice, error: currentInvoiceError } = await db.from("invoices")
      .select(INVOICE_REMINDER_POLICY_STATE_SELECT).eq("id", job.invoice_id).eq("organization_id", job.organization_id).maybeSingle();
    if (currentInvoiceError) {
      const message = reminderDatabaseError(`Opětovné ověření faktury ${job.invoice_id}`, currentInvoiceError);
      await db.rpc("fail_claimed_reminder_job", { target_log_id: job.id, target_lease_token: job.lease_token,
        failure_message: message, retry_time: atCronTime(today), failed_time: new Date().toISOString() });
      recordFailure(job.organization_id, message);
      continue;
    }

    const invoice = currentInvoice as (Invoice & InvoiceReminderPolicy) | null;
    const suppressed = invoice ? suppressedRecipients.has(`${job.organization_id}\0${invoice.counterparty_email.toLowerCase()}`) : false;
    const schedule = invoice
      ? buildEffectiveReminderSchedule(invoice.due_date, invoice.reminder_days_snapshot ?? DEFAULT_THRESHOLDS, invoice.reminder_plan_effective_from)
      : [];
    const valid = Boolean(invoice && ["pending", "overdue"].includes(invoice.status) && !invoice.reminders_paused
      && invoice.reminder_policy?.is_active !== false && !suppressed
      && isLatestEligibleReminder(schedule, today, job.scheduled_for, job.stage));
    if (!valid || !invoice) {
      await db.rpc("skip_claimed_reminder_job", { target_log_id: job.id, target_lease_token: job.lease_token, skipped_time: new Date().toISOString() });
      incrementOrganization(job.organization_id, "skipped");
      continue;
    }

    const nextFuture = schedule.find(entry => entry.scheduledFor > today) ?? null;
    try {
      const result = await sendReminderEmail({
        to: invoice.counterparty_email,
        invoice,
        stage: job.stage,
        idempotencyKey: `reminder-${job.id}`,
        template: templates.get(`${job.organization_id}\0${job.stage}`) ?? null,
        company: companies.get(job.organization_id),
      });
      if (result.error) throw new Error(result.error.message);
      const sentAt = new Date().toISOString();
      const { data: completed, error: completionError } = await db.rpc("complete_claimed_reminder_send", {
        target_log_id: job.id, target_lease_token: job.lease_token, provider_id: result.data?.id ?? null,
        sent_time: sentAt, next_time: nullableRpcString(nextFuture ? atCronTime(nextFuture.scheduledFor) : null),
      });
      if (completionError || !completed) throw new Error("Odeslání se nepodařilo potvrdit v databázi.");
      incrementOrganization(job.organization_id, "sent");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Neznámá chyba";
      await db.rpc("fail_claimed_reminder_job", { target_log_id: job.id, target_lease_token: job.lease_token,
        failure_message: message, retry_time: atCronTime(today), failed_time: new Date().toISOString() });
      recordFailure(job.organization_id, `Odeslání faktury ${invoice.invoice_number}: ${message}`);
    }
  }

  const unprocessedJobs = claimedJobs.slice(processedJobs);
  if (unprocessedJobs.length) await db.rpc("release_claimed_reminder_jobs", {
    target_lease_token: workerToken,
    target_log_ids: unprocessedJobs.map(job => job.id),
    released_time: new Date().toISOString(),
  });

  const workerDurationMs = Date.now() - workerStartedAt;
  for (const counters of organizationCounters.values()) counters.worker_duration_ms = workerDurationMs;
  const remainingCounts = await Promise.all(startedOrganizationIds.map(async organizationId => {
    const { count, error } = await db.from("reminder_log").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("status", "queued")
      .lte("available_at", new Date().toISOString()).lt("attempt_count", MAX_AUTOMATIC_REMINDER_ATTEMPTS);
    return { organizationId, count: count ?? 0, error };
  }));
  for (const result of remainingCounts) {
    if (result.error) recordFailure(result.organizationId, reminderDatabaseError("Spočítání zbývající fronty", result.error));
    else {
      const counters = organizationCounters.get(result.organizationId);
      if (counters) counters.remaining = result.count;
    }
  }

  if (!(await finishRuns())) return NextResponse.json({ error: "Výsledek automatu se nepodařilo uložit." }, { status: 500 });
  return NextResponse.json({ ...totalCounters(organizationCounters), busy_organizations: busyOrganizations });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return executeReminderAutomation();
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ ...emptyAutomationRunCounters(), checked: 4, busy_organizations: 0, demo: true });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění spustit kontrolu upomínek." }, { status: 403 });

  const { data: latestRun, error: latestRunError } = await identity.service.from("reminder_automation_runs")
    .select("status, started_at").eq("organization_id", identity.membership.organization_id)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (latestRunError) return NextResponse.json({ error: "Stav automatu se nepodařilo ověřit." }, { status: 500 });
  const blocked = manualAutomationRunBlock(latestRun as Pick<AutomationRun, "status" | "started_at"> | null);
  if (blocked === "running") return NextResponse.json({ error: "Kontrola upomínek už právě probíhá." }, { status: 409 });
  if (blocked === "cooldown") return NextResponse.json({ error: "Kontrola právě skončila. Další lze spustit za jednu minutu." }, { status: 429 });
  return executeReminderAutomation(identity.membership.organization_id, { userId: identity.user.id, email: identity.membership.email });
}
