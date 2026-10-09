import "server-only";

import QRCode from "qrcode";
import { Resend } from "resend";
import { invoiceSpayd } from "@/lib/czech-payment";
import type { Invoice, ReminderStage } from "@/types/invoice";
import { interpolateReminderTemplate, reminderTemplateValues } from "@/lib/reminder-template";
import { defaultReminderTemplates } from "@/lib/reminder-defaults";
import { reminderLogoUrl, renderReminderEmail, type ReminderEmailCompany } from "@/lib/reminder-email-template";
import { createServiceClient } from "@/lib/supabase-server";
import { assertLocalEmailRecipientsAllowed } from "@/lib/local-email-allowlist";
import { isBlockedReminderRecipient } from "@/lib/reminder-recipient-policy";

const QR_CONTENT_ID = "qr-platba";

function formatAmount(value: number) {
  return new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function appBaseUrl() {
  const configuredBase = process.env.APP_BASE_URL?.trim();
  const vercelBase = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return configuredBase || (vercelBase ? `https://${vercelBase}` : "");
}

export async function sendReminderEmail(params: {
  to: string;
  invoice: Invoice;
  stage: ReminderStage;
  idempotencyKey: string;
  template?: { subject: string; body: string; reply_to?: string | null; cc?: string[] | null } | null;
  company?: ReminderEmailCompany;
  attachment?: { filename: string; content: Uint8Array } | null;
}) {
  assertLocalEmailRecipientsAllowed([params.to, ...(params.template?.cc ?? [])]);
  const key = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_EMAIL_FROM;
  if (!key || !from) throw new Error("E-mailová služba není nakonfigurovaná.");

  const service = params.company ? null : createServiceClient();
  const { data: company, error: companyError } = params.company
    ? { data: params.company, error: null }
    : await service!.from("organizations")
      .select("name, ico, dic, registered_address, operating_address, phone, email, bank_account_czk, bank_account_eur, logo_path")
      .eq("id", params.invoice.organization_id).single();
  if (companyError || !company) throw new Error("Firemní údaje pro e-mail se nepodařilo načíst.");
  if (isBlockedReminderRecipient(params.to, company)) {
    throw new Error("Upomínku nelze odeslat na e-mail vystavitele faktury.");
  }

  const template = params.template ?? defaultReminderTemplates[params.stage];
  const subject = interpolateReminderTemplate(template.subject, params.invoice);
  const message = interpolateReminderTemplate(template.body, params.invoice);
  const replyTo = params.template?.reply_to ?? company.email ?? undefined;
  // QR platba přímo v těle: dlužník ji načte v bance a VS se vyplní sám.
  // Inline příloha (cid:), protože data: URI Gmail blokuje. Bez platného
  // účtu QR není -- nejistý kód by poslal peníze jinam.
  const spayd = invoiceSpayd(params.invoice, company as ReminderEmailCompany);
  const qrPng = spayd
    ? await QRCode.toBuffer(spayd, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 440 })
    : null;
  const paid = Number(params.invoice.paid_amount);
  const total = Number(params.invoice.amount);
  const payment = paid > 0 && paid < total
    ? { total: formatAmount(total), paid: formatAmount(paid), remaining: formatAmount(total - paid) }
    : null;
  const rendered = renderReminderEmail({
    company: company as ReminderEmailCompany,
    stage: params.stage,
    subject,
    message,
    values: reminderTemplateValues(params.invoice),
    logoUrl: reminderLogoUrl((company as ReminderEmailCompany).logo_path, appBaseUrl()),
    replyTo,
    qrSrc: qrPng ? `cid:${QR_CONTENT_ID}` : null,
    payment,
  });

  const attachments = [
    ...(params.attachment ? [{ filename: params.attachment.filename, content: Buffer.from(params.attachment.content) }] : []),
    ...(qrPng ? [{ filename: "qr-platba.png", content: qrPng, contentId: QR_CONTENT_ID }] : []),
  ];
  const resend = new Resend(key);
  return resend.emails.send({
    from,
    to: params.to,
    cc: params.template?.cc?.length ? params.template.cc : undefined,
    replyTo,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments: attachments.length ? attachments : undefined,
  }, { idempotencyKey: params.idempotencyKey });
}
