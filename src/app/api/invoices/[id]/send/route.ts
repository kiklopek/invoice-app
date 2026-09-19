import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { sendReminderEmail } from "@/lib/email";
import { generateInvoicePdf, invoicePdfFilename } from "@/lib/invoice-pdf";
import { compareDate, todayInTimeZone } from "@/lib/reminders";
import type { Invoice, ReminderStage } from "@/types/invoice";

type Context = { params: Promise<{ id: string }> };

function stageForInvoice(invoice: Invoice, today: string): ReminderStage {
  const comparison = compareDate(invoice.due_date, today);
  if (comparison < 0) return "overdue";
  if (comparison === 0) return "on_due";
  return "before_due";
}

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const { id } = await params;
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) {
    return NextResponse.json({ error: "Nemáte oprávnění fakturu odeslat." }, { status: 403 });
  }

  const organizationId = identity.membership.organization_id;
  const { data: invoiceData, error: invoiceError } = await identity.service.from("invoices").select("*")
    .eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (invoiceError) return NextResponse.json({ error: "Fakturu se nepodařilo načíst." }, { status: 500 });
  if (!invoiceData) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });
  const invoice = invoiceData as Invoice;

  const { data: company, error: companyError } = await identity.service.from("organizations")
    .select("name, ico, dic, registered_address, operating_address, phone, email, bank_account_czk, bank_account_eur")
    .eq("id", organizationId).maybeSingle();
  if (companyError || !company) return NextResponse.json({ error: "Firemní údaje pro e-mail se nepodařilo načíst." }, { status: 500 });

  try {
    const attachment = { filename: invoicePdfFilename(invoice), content: await generateInvoicePdf(invoice, company) };
    const result = await sendReminderEmail({
      to: invoice.counterparty_email,
      invoice,
      stage: stageForInvoice(invoice, todayInTimeZone()),
      idempotencyKey: `invoice-send-${id}-${crypto.randomUUID()}`,
      company,
      attachment,
    });
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Fakturu se nepodařilo odeslat e-mailem." }, { status: 502 });
  }
}
