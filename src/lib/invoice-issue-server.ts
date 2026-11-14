import "server-only";
import { createHash } from "node:crypto";
import type { RequestIdentity } from "./auth";
import type { Invoice } from "@/types/invoice";
import { canManageInvoices } from "./role-access";
import { subscriptionBlock, subscriptionErrorResponse } from "./billing-server";
import { CREATION_COMPANY_FIELDS, creationRequest, creationSupplier, prepareCreation, sameCreation } from "./invoice-creation-server";
import { InvoiceCreationError, issuedDocument } from "./invoice-creation";
import { initialNextReminderAt, todayInTimeZone } from "./reminders";
import { ownInvoiceAccount, paymentAccountFor } from "./bank-accounts";
import { isBlockedReminderRecipient } from "./reminder-recipient-policy";
import { minorUnits } from "./money";
import { lookupAresSubject } from "./ares";
import { companyNamesAgree } from "./invoice-ocr-registry";
import { OCR_REVIEW_FIELDS } from "./invoice-ocr";
import { logError } from "./structured-log";

export type InvoiceIssueIdentity = {
  service: RequestIdentity["service"];
  membership: Pick<RequestIdentity["membership"], "organization_id" | "role">;
  user: { id: string };
};
export class InvoiceIssueError extends InvoiceCreationError {
  constructor(message: string, status: number, public readonly code: string, public readonly details: Record<string, unknown> = {}) { super(message, status); }
}
export type InvoiceIssueOptions = { autoNumber?: boolean; defaultPaymentAccount?: boolean; paidAmount?: number; expectedTotal?: number; requestHash?: string };
export type InvoiceIssueResult = { invoice: Invoice; replayed: boolean; refresh_required?: boolean };

/** Shared by the web form and machine API. Database triggers remain the final
 * authority for monetary state, customer linking, audit and subscription limits. */
export async function issueCreation(identity: InvoiceIssueIdentity, value: unknown, options: InvoiceIssueOptions = {}): Promise<InvoiceIssueResult> {
  if (!canManageInvoices(identity.membership.role)) throw new InvoiceIssueError("Nemáte oprávnění vytvářet faktury.", 403, "forbidden");
  const organizationId = identity.membership.organization_id;
  const { draft, hash: draftHash } = creationRequest(value);
  // Include payment evidence and public API payload in retries. A changed paid
  // amount must never be mistaken for the original issuance.
  const hash = options.requestHash || (options.paidAmount !== undefined
    ? createHash("sha256").update(JSON.stringify({ draft: draftHash, paid_amount: options.paidAmount })).digest("hex")
    : draftHash);
  const lookup = async () => {
    const { data, error } = await identity.service.from("invoices").select("*").eq("id", draft.request_id).eq("organization_id", organizationId).maybeSingle();
    if (error) throw new InvoiceIssueError("Vystavení faktury se nepodařilo ověřit.", 503, "invoice_replay_failed");
    if (!data) return null;
    if (!sameCreation(issuedDocument(data), draft.request_id, hash)) throw new InvoiceIssueError("Tento požadavek už vystavil jiný doklad. Otevřete uloženou fakturu.", 409, "idempotency_conflict");
    return { invoice: data as Invoice, replayed: true };
  };
  const replay = await lookup();
  if (replay) return replay;
  const blocked = await subscriptionBlock(identity);
  if (blocked) {
    const error = await blocked.json();
    throw new InvoiceIssueError(error.error, blocked.status, error.code);
  }
  const { data: issuer, error: issuerError } = await identity.service.from("organizations").select(CREATION_COMPANY_FIELDS).eq("id", organizationId).single();
  if (issuerError || !issuer) throw new InvoiceIssueError("Firemní údaje se nepodařilo ověřit.", 503, "invoice_issuer_read_failed");
  if (options.defaultPaymentAccount && draft.payment_method === "bank" && !draft.payment_account) {
    draft.payment_account = paymentAccountFor(draft.currency, issuer, issuer.bank_accounts ?? []) ?? "";
  }
  // Validate financial input before reserving a number. The reservation may
  // leave a gap on a later failure, but can never assign a duplicate number.
  const prepared = await prepareCreation(options.autoNumber ? { ...draft, invoice_number: "API-PENDING" } : draft, creationSupplier(issuer), identity);
  const { input, document } = prepared;
  document.request_hash = hash;
  if (options.expectedTotal !== undefined && (!Number.isFinite(options.expectedTotal) || minorUnits(options.expectedTotal) !== minorUnits(input.amount))) {
    throw new InvoiceIssueError("Součet položek se neshoduje s očekávanou částkou.", 422, "total_mismatch", { computed: input.amount });
  }
  const paidAmount = options.paidAmount ?? 0;
  if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > input.amount || Math.abs(paidAmount * 100 - Math.round(paidAmount * 100)) > 1e-7) {
    throw new InvoiceIssueError("Uhrazená částka musí být nezáporná, nejvýše do výše faktury a se dvěma desetinnými místy.", 400, "invalid_paid_amount");
  }
  if (paidAmount > 0 && input.money_evidence) {
    input.money_evidence.initial_paid = paidAmount;
    input.money_evidence.initial_paid_confirmed = true;
  }
  if (isBlockedReminderRecipient(input.counterparty_email, issuer)) throw new InvoiceIssueError("E-mail pro upomínky patří vaší firmě. Zadejte adresu odběratele.", 400, "invalid_customer_email");
  let verifiedUpload: { id: string; ocr_model: string | null; ocr_proposed_values: unknown; ocr_field_decisions: unknown; ocr_vocabulary_version: string | null } | null = null;
  if (input.file_url) {
    if (!input.file_url.startsWith(`${organizationId}/`)) throw new InvoiceIssueError("Dokument nepatří do této organizace.", 403, "forbidden_document");
    const { data: upload, error } = await identity.service.from("invoice_uploads")
      .select("id, ocr_model, ocr_proposed_values, ocr_field_decisions, ocr_vocabulary_version")
      .eq("organization_id", organizationId).eq("path", input.file_url).eq("created_by", identity.user.id)
      .eq("status", "verified").gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error || !upload) throw new InvoiceIssueError("Dokument není bezpečně ověřený nebo jeho nahrávání vypršelo.", 400, "invalid_document");
    verifiedUpload = upload;
  }
  const { data: policy, error: policyError } = await identity.service.from("reminder_policies").select("id, days_from_due, is_active")
    .eq("organization_id", organizationId).is("archived_at", null).eq("is_default", true).maybeSingle();
  if (policyError || !policy) throw new InvoiceIssueError("Vybraná kategorie upomínek není dostupná.", 400, "reminder_policy_unavailable");
  const reminderDays = policy.days_from_due ?? [-3, 0, 7, 14];
  const paymentAccount = ownInvoiceAccount(document.payment_account, input.currency, issuer, issuer.bank_accounts ?? []);
  let invoice: Invoice | null = null;
  for (let attempt = 0; attempt < (options.autoNumber ? 5 : 1); attempt++) {
    if (options.autoNumber) {
      const { data: number, error } = await identity.service.rpc("reserve_invoice_number", { target_org: organizationId, actor_user: identity.user.id, invoice_year: Number(draft.issue_date.slice(0, 4)) });
      if (error || typeof number !== "string" || !/^FV-\d{4}-\d{6,}$/.test(number)) throw new InvoiceIssueError("Číslo faktury se nepodařilo přidělit.", 503, "invoice_number_unavailable");
      input.invoice_number = number;
      document.invoice_number = number;
    }
    const { data, error } = await identity.service.from("invoices").insert({
      ...input,
      id: draft.request_id,
      customer_id: document.customer_id || null,
      ...(input.counterparty_email ? {} : { reminders_paused: true, reminders_paused_at: new Date().toISOString(), reminders_paused_by: identity.user.id }),
      file_url: input.file_url ?? null,
      ...(paymentAccount ? { payment_account: paymentAccount } : {}),
      organization_id: organizationId,
      reminder_policy_id: policy.id,
      reminder_days_snapshot: reminderDays,
      reminder_plan_effective_from: null,
      next_reminder_at: policy.is_active === false || !input.counterparty_email ? null : initialNextReminderAt(input.due_date, reminderDays, todayInTimeZone()),
      created_by: identity.user.id,
    }).select("*").single();
    if (!error && data) { invoice = data as Invoice; break; }
    if (error?.code === "23505") {
      const concurrent = await lookup();
      if (concurrent) return concurrent;
      if (options.autoNumber && attempt < 4) continue;
      throw new InvoiceIssueError("Číslo faktury nebo přiložený dokument už je evidován.", 409, "invoice_conflict");
    }
    const subscriptionError = subscriptionErrorResponse(error);
    if (subscriptionError) {
      const body = await subscriptionError.json();
      throw new InvoiceIssueError(body.error, subscriptionError.status, body.code);
    }
    throw new InvoiceIssueError("Fakturu se nepodařilo uložit.", 500, "invoice_insert_failed");
  }
  if (!invoice) throw new InvoiceIssueError("Fakturu se nepodařilo uložit.", 500, "invoice_insert_failed");
  if (invoice.customer_id && input.counterparty_ico) {
    const registry = await lookupAresSubject(input.counterparty_ico);
    if (registry.status === "found" && registry.subject.address && companyNamesAgree(input.counterparty_name, registry.subject.name)) {
      const { error } = await identity.service.from("customers").update({ address: registry.subject.address }).eq("id", invoice.customer_id).eq("organization_id", organizationId).is("address", null);
      if (error) logError("Sídlo klienta z ARES se nepodařilo uložit", error, { customer_id: invoice.customer_id });
    }
  }
  if (verifiedUpload) {
    await identity.service.from("invoice_uploads").update({ status: "claimed", invoice_id: invoice.id }).eq("id", verifiedUpload.id).eq("status", "verified");
    if (verifiedUpload.ocr_model && verifiedUpload.ocr_vocabulary_version) {
      const proposed = (verifiedUpload.ocr_proposed_values && typeof verifiedUpload.ocr_proposed_values === "object" ? verifiedUpload.ocr_proposed_values : {}) as Record<string, unknown>;
      const normalized = (v: unknown) => typeof v === "string" ? v.trim().toLocaleLowerCase("cs") : v;
      const { error } = await identity.service.from("invoice_ocr_reviews").insert({
        organization_id: organizationId, upload_id: verifiedUpload.id, invoice_id: invoice.id,
        proposed_values: JSON.parse(JSON.stringify(Object.fromEntries(OCR_REVIEW_FIELDS.map(field => [field, proposed[field] ?? null])))),
        final_values: JSON.parse(JSON.stringify(Object.fromEntries(OCR_REVIEW_FIELDS.map(field => [field, input[field] ?? null])))),
        corrected_fields: OCR_REVIEW_FIELDS.filter(field => normalized(proposed[field]) !== normalized(input[field])),
        field_decisions: JSON.parse(JSON.stringify(verifiedUpload.ocr_field_decisions ?? {})), vocabulary_version: verifiedUpload.ocr_vocabulary_version,
        ocr_model: verifiedUpload.ocr_model, reviewed_by: identity.user.id,
      });
      if (error) logError("Audit OCR oprav se nepodařilo uložit", error, { invoice_id: invoice.id });
    }
  }
  if (paidAmount > 0) {
    const { data: refreshed, error } = await identity.service.from("invoices").select("*").eq("id", invoice.id).eq("organization_id", organizationId).single();
    if (error || !refreshed) return { invoice, replayed: false, refresh_required: true };
    invoice = refreshed as Invoice;
  }
  return { invoice, replayed: false };
}
