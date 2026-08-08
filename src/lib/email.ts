import "server-only";

import { Resend } from "resend";
import type { Invoice, ReminderStage } from "@/types/invoice";
import { interpolateReminderTemplate, reminderTemplateValues } from "@/lib/reminder-template";
import { defaultReminderTemplates } from "@/lib/reminder-defaults";
import { renderReminderEmail, type ReminderEmailCompany } from "@/lib/reminder-email-template";
import { createServiceClient } from "@/lib/supabase-server";

function reminderLogoUrl() {
  const explicit = process.env.REMINDER_LOGO_URL?.trim();
  if (explicit) return explicit;
  const configuredBase = process.env.APP_BASE_URL?.trim();
  const vercelBase = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const base = configuredBase || (vercelBase ? `https://${vercelBase}` : "");
  if (!base) return null;
  try {
    return new URL("/brand/drevohlavica.png", base).toString();
  } catch {
    return null;
  }
}

export async function sendReminderEmail(params: {
  to: string;
  invoice: Invoice;
  stage: ReminderStage;
  idempotencyKey: string;
  template?: { subject: string; body: string; reply_to?: string | null; cc?: string[] | null } | null;
}) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_EMAIL_FROM;
  if (!key || !from) throw new Error("E-mailová služba není nakonfigurovaná.");

  const service = createServiceClient();
  const { data: company, error: companyError } = await service.from("organizations")
    .select("name, ico, dic, registered_address, operating_address, phone, email, bank_account_czk, bank_account_eur")
    .eq("id", params.invoice.organization_id).single();
  if (companyError || !company) throw new Error("Firemní údaje pro e-mail se nepodařilo načíst.");

  const template = params.template ?? defaultReminderTemplates[params.stage];
  const subject = interpolateReminderTemplate(template.subject, params.invoice);
  const message = interpolateReminderTemplate(template.body, params.invoice);
  const replyTo = params.template?.reply_to ?? company.email ?? undefined;
  const rendered = renderReminderEmail({
    company: company as ReminderEmailCompany,
    stage: params.stage,
    subject,
    message,
    values: reminderTemplateValues(params.invoice),
    logoUrl: reminderLogoUrl(),
    replyTo,
  });

  const resend = new Resend(key);
  return resend.emails.send({
    from,
    to: params.to,
    cc: params.template?.cc?.length ? params.template.cc : undefined,
    replyTo,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  }, { idempotencyKey: params.idempotencyKey });
}
