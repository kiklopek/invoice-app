import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { logError, requestId } from "@/lib/structured-log";
import { apiError } from "@/lib/api-response";
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
  if (invoiceError) {
    logError("Fakturu pro odeslání e-mailem se nepodařilo načíst", invoiceError, { invoice_id: id });
    return apiError(request, "Fakturu se nepodařilo načíst.", 500, "invoice_read_failed");
  }
  if (!invoiceData) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });
  const invoice = invoiceData as Invoice;

  const { data: company, error: companyError } = await identity.service.from("organizations")
    .select("name, ico, dic, registered_address, operating_address, phone, email, bank_account_czk, bank_account_eur")
    .eq("id", organizationId).maybeSingle();
  if (companyError || !company) {
    logError("Firemní údaje pro odeslání e-mailem se nepodařilo načíst", companyError, { invoice_id: id });
    return apiError(request, "Firemní údaje pro e-mail se nepodařilo načíst.", 500, "company_read_failed");
  }

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
    // Zpráva odběrateli už odešla. Zápis do aktivity je od téhle chvíle jen
    // stopa pro účetní -- kdyby selhal, nesmí to shodit odpověď, protože
    // uživatel by odeslal znovu a zákazník by dostal fakturu dvakrát.
    const { error: eventError } = await identity.service.from("invoice_events").insert({
      organization_id: organizationId,
      invoice_id: id,
      actor_user_id: identity.user.id,
      event_type: "emailed",
      details: { sent_to: invoice.counterparty_email },
    });
    if (eventError) {
      logError("Odeslání faktury se nepodařilo zapsat do aktivity", eventError, { request_id: requestId(request), invoice_id: id });
    }
    return NextResponse.json({ ok: true });
  } catch (cause) {
    // Sem spadnou chyby z generování PDF a z Resendu -- anglické technické
    // hlášky knihoven, které uživateli nic neřeknou. Detail do logu,
    // uživateli srozumitelná věta.
    logError("Odeslání faktury e-mailem selhalo", cause, { request_id: requestId(request), invoice_id: id });
    return apiError(request, "Fakturu se nepodařilo odeslat e-mailem. Zkuste to prosím znovu za chvíli.", 502, "invoice_send_failed");
  }
}
