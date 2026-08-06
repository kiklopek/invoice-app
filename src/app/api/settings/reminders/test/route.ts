import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { sendReminderEmail } from "@/lib/email";
import { unsupportedTemplateVariables } from "@/lib/reminder-template";
import { isSameOriginMutation } from "@/lib/request-security";
import { todayInTimeZone } from "@/lib/reminders";
import { isDemoMode } from "@/lib/supabase-server";
import type { Invoice, ReminderStage } from "@/types/invoice";

const stages: ReminderStage[] = ["before_due", "on_due", "overdue", "escalation"];

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const stage = body?.stage;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const templateBody = typeof body?.body === "string" ? body.body.trim() : "";
  if (typeof stage !== "string" || !stages.includes(stage as ReminderStage)) {
    return NextResponse.json({ error: "Vyberte platný typ upomínky." }, { status: 400 });
  }
  if (!subject || !templateBody || subject.length > 300 || templateBody.length > 20_000) {
    return NextResponse.json({ error: "Zkontrolujte předmět a text testovací zprávy." }, { status: 400 });
  }
  const unsupported = [...new Set([subject, templateBody].flatMap(unsupportedTemplateVariables))];
  if (unsupported.length) {
    return NextResponse.json({ error: `Nepodporované proměnné: ${unsupported.map(item => `{{${item}}}`).join(", ")}.` }, { status: 400 });
  }
  if (isDemoMode()) return NextResponse.json({ sent: true, recipient: "ucetni@hlavica.cz" });

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) {
    return NextResponse.json({ error: "Nemáte oprávnění odeslat testovací e-mail." }, { status: 403 });
  }
  const recipient = identity.user.email?.trim().toLowerCase();
  if (!recipient) return NextResponse.json({ error: "Přihlášený účet nemá ověřenou e-mailovou adresu." }, { status: 400 });

  const today = todayInTimeZone();
  const sampleInvoice: Invoice = {
    id: "template-test",
    organization_id: identity.membership.organization_id,
    reminder_policy_id: null,
    invoice_number: "TEST-2026-001",
    counterparty_name: "Ukázkový odběratel s.r.o.",
    counterparty_ico: "12345678",
    counterparty_dic: "CZ12345678",
    counterparty_email: recipient,
    variable_symbol: "2026001",
    amount: 12500,
    paid_amount: 0,
    currency: "CZK",
    issue_date: today,
    due_date: addDays(today, 7),
    status: "pending",
    source: "manual",
    file_url: null,
    notes: null,
    paid_at: null,
    reminders_sent: 0,
    last_reminder_at: null,
    next_reminder_at: null,
    reminders_paused: false,
    reminders_paused_at: null,
    reminders_paused_by: null,
    updated_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    const result = await sendReminderEmail({
      to: recipient,
      invoice: sampleInvoice,
      stage: stage as ReminderStage,
      idempotencyKey: `template-test-${identity.user.id}-${crypto.randomUUID()}`,
      template: { subject: `[TEST] ${subject}`, body: templateBody },
    });
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ sent: true, recipient });
  } catch {
    return NextResponse.json({ error: "Testovací e-mail se nepodařilo odeslat. Zkontrolujte nastavení e-mailové služby." }, { status: 502 });
  }
}
