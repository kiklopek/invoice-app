import { createHash } from "node:crypto";
import { EmailSuppressedError } from "@/lib/email-suppression";
import { issuedDocument } from "@/lib/invoice-creation";
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
    logError("Fakturu pro odeslání e-mailem se nepodařilo načíst", invoiceError, { request_id: requestId(request), invoice_id: id });
    return apiError(request, "Fakturu se nepodařilo načíst.", 500, "invoice_read_failed");
  }
  if (!invoiceData) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });
  const invoice = invoiceData as Invoice;

  const { data: company, error: companyError } = await identity.service.from("organizations")
    .select("name, ico, dic, registered_address, operating_address, phone, email, bank_account_czk, bank_account_eur, vat_payer, logo_path, bank_accounts:organization_bank_accounts(account, currency)")
    .eq("id", organizationId).maybeSingle();
  if (companyError || !company) {
    logError("Firemní údaje pro odeslání e-mailem se nepodařilo načíst", companyError, { request_id: requestId(request), invoice_id: id });
    return apiError(request, "Firemní údaje pro e-mail se nepodařilo načíst.", 500, "company_read_failed");
  }

  const body = await request.json().catch(() => null) as { purpose?: string; recipient_confirmed?: boolean } | null;
  const issueSend = body?.purpose === "issue";
  const snapshot = issuedDocument(invoice);
  if (issueSend && (!snapshot || body?.recipient_confirmed !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoice.counterparty_email))) {
    return NextResponse.json({ error: "Potvrďte platný e-mail odběratele vystaveného dokladu." }, { status: 400 });
  }
  const actionId = request.headers.get("x-idempotency-key");
  if (actionId !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(actionId)) return NextResponse.json({ error: "Neplatný identifikátor odeslání." }, { status: 400 });
  if (issueSend) {
    const { data: sent, error } = await identity.service.from("invoice_events").select("id").eq("organization_id", organizationId).eq("invoice_id", id).eq("event_type", "emailed").contains("details", { purpose: "issue" }).limit(1);
    if (error) {
      logError("Stav odeslání se nepodařilo ověřit", error, { request_id: requestId(request), invoice_id: id });
      return apiError(request, "Stav odeslání se nepodařilo ověřit.", 503, "email_state_failed");
    }
    if (sent?.length) return NextResponse.json({ ok: true, already_sent: true });
  }
  // Historical legal identity and bank details come from issuance, never current settings.
  const deliveryCompany = snapshot ? { ...company, ...snapshot.supplier, registered_address: snapshot.supplier.address,
    bank_account_czk: snapshot.currency === "CZK" ? snapshot.payment_account : null,
    bank_account_eur: snapshot.currency === "EUR" ? snapshot.payment_account : null,
    bank_accounts: snapshot.payment_account ? [{ account: snapshot.payment_account, currency: snapshot.currency }] : [] } : company;
  // Bind retries to the same document, recipient and legal sender details.
  const payloadHash = createHash("sha256").update(JSON.stringify({ invoice, company: deliveryCompany, issueSend })).digest("hex");
  const { data: claimData, error: claimError } = await identity.service.rpc("claim_invoice_email", {
    target_org: organizationId, actor_user: identity.user.id, target_invoice: id,
    send_purpose: issueSend ? "issue" : "manual", action_id: actionId, payload_hash: payloadHash,
  });
  if (claimError || !claimData) {
    logError("Odeslání faktury se nepodařilo rezervovat", claimError, { request_id: requestId(request), invoice_id: id });
    return apiError(request, "Stav odeslání se nepodařilo ověřit. Zkuste to později.", 503, "email_claim_failed");
  }
  const claim = claimData as { state: string; id?: string; lease_token?: string };
  if (claim.state === "accepted") return NextResponse.json({ ok: true, already_sent: true });
  if (claim.state === "suppressed") return NextResponse.json({ error: new EmailSuppressedError().message, code: "email_suppressed" }, { status: 409 });
  if (claim.state !== "claimed" || !claim.id || !claim.lease_token) return NextResponse.json({
    error: claim.state === "busy" ? "Odesílání této faktury právě probíhá. Počkejte prosím."
      : claim.state === "invalid_recipient" ? "Doplňte platný e-mail odběratele."
      : "Předchozí odeslání vyžaduje kontrolu. Než fakturu odešlete znovu, ověřte jeho stav.",
    code: `email_${claim.state}`,
  }, { status: 409 });
  try {
    const attachment = { filename: invoicePdfFilename(invoice), content: await generateInvoicePdf(invoice, company) };
    const result = await sendReminderEmail({
      delivery: { id: claim.id, leaseToken: claim.lease_token },
      to: invoice.counterparty_email,
      invoice,
      stage: stageForInvoice(invoice, todayInTimeZone()),
      ...(issueSend ? { purpose: "issue" as const } : {}),
      idempotencyKey: issueSend ? `invoice-issued-${id}` : `invoice-send-${claim.id}`,
      ...(issueSend ? { template: { subject: "Faktura {{invoice_number}}", body: "Dobrý den,\n\nv příloze vám zasíláme vystavenou fakturu. Údaje pro úhradu najdete na dokladu.\n\nDěkujeme za spolupráci." } } : {}),
      company: deliveryCompany,
      attachment,
    });
    if (result.error || !result.data?.id) throw new Error(result.error?.message || "E-mailová služba nepotvrdila přijetí zprávy.");
    const { error: finishError } = await identity.service.rpc("finish_invoice_email", {
      target_org: organizationId, delivery_id: claim.id, claim_token: claim.lease_token, accepted_provider_id: result.data.id,
    });
    if (finishError) logError("Přijetí e-mailu se nepodařilo uložit", finishError, { request_id: requestId(request), invoice_id: id, delivery_id: claim.id });
    // Zpráva odběrateli už odešla. Zápis do aktivity je od téhle chvíle jen
    // stopa pro účetní -- kdyby selhal, nesmí to shodit odpověď, protože
    // uživatel by odeslal znovu a zákazník by dostal fakturu dvakrát.
    const { error: eventError } = await identity.service.from("invoice_events").insert({
      organization_id: organizationId,
      invoice_id: id,
      actor_user_id: identity.user.id,
      event_type: "emailed",
      details: { sent_to: invoice.counterparty_email, ...(issueSend ? { purpose: "issue" } : {}) },
    });
    if (eventError) {
      logError("Odeslání faktury se nepodařilo zapsat do aktivity", eventError, { request_id: requestId(request), invoice_id: id });
    }
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const { error: finishError } = await identity.service.rpc("finish_invoice_email", {
      target_org: organizationId, delivery_id: claim.id, claim_token: claim.lease_token, accepted_provider_id: null,
    });
    if (finishError) logError("Neúspěšné odeslání se nepodařilo uložit", finishError, { request_id: requestId(request), invoice_id: id });
    if (cause instanceof EmailSuppressedError) return NextResponse.json({ error: cause.message, code: "email_suppressed" }, { status: 409 });
    // Sem spadnou chyby z generování PDF a z Resendu -- anglické technické
    // hlášky knihoven, které uživateli nic neřeknou. Detail do logu,
    // uživateli srozumitelná věta.
    logError("Odeslání faktury e-mailem selhalo", cause, { request_id: requestId(request), invoice_id: id });
    return apiError(request, "Fakturu se nepodařilo odeslat e-mailem. Zkuste to prosím znovu za chvíli.", 502, "invoice_send_failed");
  }
}
