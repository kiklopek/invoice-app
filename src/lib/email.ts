import "server-only";

import { Resend } from "resend";
import type { Invoice, ReminderStage } from "@/types/invoice";
import { interpolateReminderTemplate } from "@/lib/reminder-template";
import { defaultReminderTemplates } from "@/lib/reminder-defaults";

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

  const fallbackBody = `Dobrý den,

evidujeme neuhrazenou fakturu {{invoice_number}} ve výši {{amount}} {{currency}},
se splatností {{due_date}} a variabilním symbolem {{variable_symbol}}.

Prosíme o kontrolu a úhradu. Pokud jste již platbu odeslali, považujte tuto zprávu za bezpředmětnou.

Děkujeme
Hlavica Dřevo`;

  const resend = new Resend(key);
  return resend.emails.send({
    from,
    to: params.to,
    cc: params.template?.cc?.length ? params.template.cc : undefined,
    replyTo: params.template?.reply_to ?? undefined,
    subject: interpolateReminderTemplate(params.template?.subject ?? defaultReminderTemplates[params.stage].subject, params.invoice),
    text: interpolateReminderTemplate(params.template?.body ?? fallbackBody, params.invoice),
  }, { idempotencyKey: params.idempotencyKey });
}
