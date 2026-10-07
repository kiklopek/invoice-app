import "server-only";

import { Resend } from "resend";
import type { RequestIdentity } from "@/lib/auth";
import { normalizeBillingDetails, subscriptionState, supplierConfiguration, type BillingDetails, type SubscriptionRow } from "@/lib/billing";
import type { BillingOrderForDocument } from "@/lib/billing-document";
import { generateBillingPdf } from "@/lib/billing-pdf";
import { comgateConfiguration, createComgatePayment, getComgatePayment } from "@/lib/comgate";
import { assertLocalEmailRecipientsAllowed } from "@/lib/local-email-allowlist";
import { getPasswordRecoveryBaseUrl } from "@/lib/password-recovery-server";
import { findPlan, isBillingPeriod, quote, type BillingPeriod, type PlanId } from "@/lib/plans";
import { logError } from "@/lib/structured-log";
import { createServiceClient } from "@/lib/supabase-server";

const ORDER_COLUMNS = "id, organization_id, order_number, variable_symbol, plan, period, months, net_halere, vat_halere, gross_halere, payment_method, status, gateway_transaction_id, billing, invoice_number, created_at, paid_at";

export async function loadSubscription(service: RequestIdentity["service"], organizationId: string) {
  const { data } = await service.from("subscriptions")
    .select("status, plan, period, trial_ends_at, current_period_end")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return { row: data as (SubscriptionRow & { plan: string | null; period: string | null }) | null, state: subscriptionState(data) };
}

type OrderInput = { plan?: unknown; period?: unknown; method?: unknown; billing?: unknown };
export type OrderResult =
  | { ok: true; orderId: string; redirect: string }
  | { ok: false; status: number; code: string; error: string };

// Objednávka tarifu. Částku počítá server z plans.ts; z prohlížeče se bere jen
// volba tarifu, období a způsobu platby. Databáze odmítne neověřenou firmu.
export async function createOrder(identity: RequestIdentity, input: OrderInput, returnBase = getPasswordRecoveryBaseUrl()): Promise<OrderResult> {
  const plan = findPlan(typeof input.plan === "string" ? input.plan : null);
  if (!plan || !isBillingPeriod(input.period)) return { ok: false, status: 400, code: "invalid_plan", error: "Vyberte tarif a období." };
  const method = input.method === "card" || input.method === "transfer" ? input.method : null;
  if (!method) return { ok: false, status: 400, code: "invalid_method", error: "Vyberte způsob platby." };
  const billing = normalizeBillingDetails(input.billing);
  if (!billing.ok) return { ok: false, status: 400, code: "invalid_billing", error: billing.error };
  const supplier = supplierConfiguration();
  if (!supplier) return { ok: false, status: 503, code: "billing_unavailable", error: "Nákup teď není dostupný. Zkuste to prosím později." };
  if (method === "card" && !comgateConfiguration()) {
    return { ok: false, status: 503, code: "card_unavailable", error: "Platba kartou teď není dostupná. Zvolte platbu převodem." };
  }

  const price = quote(plan.id as PlanId, input.period as BillingPeriod);
  const vat = supplier.vatPayer ? price.vatHalere : 0;
  const { data, error } = await identity.service.rpc("create_billing_order", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
    target_plan: plan.id,
    target_period: price.period,
    target_months: price.months,
    net: price.netHalere,
    vat,
    gross: price.netHalere + vat,
    method,
    billing: billing.details,
  });
  if (error) {
    if (error.message.includes("organization_not_verified")) {
      return { ok: false, status: 403, code: "not_verified", error: "Před nákupem je potřeba ověřit firmu přes datovou schránku (Nastavení → Firma)." };
    }
    if (error.message.includes("insufficient_permission")) return { ok: false, status: 403, code: "forbidden", error: "Tarif může koupit jen administrátor firmy." };
    logError("Objednávku tarifu se nepodařilo založit", error);
    return { ok: false, status: 500, code: "order_failed", error: "Objednávku se nepodařilo založit." };
  }
  const order = data as { order_id: string; order_number: string; gross_halere: number };
  const returnUrl = new URL(`/predplatne/navrat?objednavka=${order.order_id}`, returnBase).toString();

  if (method === "card") {
    const payment = await createComgatePayment({
      orderId: order.order_id,
      priceHalere: order.gross_halere,
      label: `Splatno ${plan.name}`,
      email: billing.details.email,
      returnUrl,
    });
    if (!payment.ok) return { ok: false, status: 502, code: "gateway_failed", error: "Platební bránu se nepodařilo otevřít. Zkuste to znovu, nebo zvolte převod." };
    const { error: attachError } = await identity.service.rpc("attach_billing_transaction", { target_order: order.order_id, transaction_id: payment.transId });
    if (attachError) {
      logError("Transakci brány se nepodařilo připojit k objednávce", attachError);
      return { ok: false, status: 500, code: "order_failed", error: "Objednávku se nepodařilo připravit." };
    }
    return { ok: true, orderId: order.order_id, redirect: payment.redirect };
  }

  await sendBillingEmail(order.order_id, "request");
  return { ok: true, orderId: order.order_id, redirect: returnUrl };
}

export async function loadOrder(orderId: string, organizationId?: string) {
  let query = createServiceClient().from("billing_orders").select(ORDER_COLUMNS).eq("id", orderId);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data } = await query.maybeSingle();
  return data as (BillingOrderForDocument & { id: string; organization_id: string; payment_method: string; gateway_transaction_id: string | null; billing: Partial<BillingDetails> }) | null;
}

// Zaplacení objednávky (brána nebo provozovatel). Idempotentní v databázi;
// fakturu e-mailem posíláme jen při prvním zaplacení.
export async function settleOrder(orderId: string, source: "comgate" | "operator", transactionId: string | null, paidHalere: number) {
  const { data, error } = await createServiceClient().rpc("mark_billing_order_paid", {
    target_order: orderId, source, transaction_id: transactionId, paid_halere: paidHalere,
  });
  if (error) {
    logError("Zaplacení objednávky se nepodařilo zapsat", error, { order_id: orderId });
    return { ok: false as const, reason: error.message };
  }
  const result = data as { already_paid?: boolean };
  if (!result.already_paid) await sendBillingEmail(orderId, "invoice");
  return { ok: true as const, alreadyPaid: Boolean(result.already_paid) };
}

/** Ověří platbu u Comgate (nikdy jen podle oznámení) a případně ji zapíše. */
export async function syncCardPayment(orderId: string) {
  const order = await loadOrder(orderId);
  if (!order || order.payment_method !== "card" || !order.gateway_transaction_id) return { state: "unknown" as const };
  if (order.status === "paid") return { state: "paid" as const };
  const payment = await getComgatePayment(order.gateway_transaction_id);
  if (!payment.ok) return { state: "unknown" as const };
  if (payment.refId !== order.id || payment.currency !== "CZK") {
    logError("Platba z brány nesedí k objednávce", null, { order_id: orderId });
    return { state: "mismatch" as const };
  }
  if (payment.status === "PAID") {
    const settled = await settleOrder(order.id, "comgate", payment.transId, payment.priceHalere);
    return { state: settled.ok ? "paid" as const : "mismatch" as const };
  }
  return { state: payment.status === "CANCELLED" ? "cancelled" as const : "pending" as const };
}

/** Faktura e-mailem po zaplacení potvrzeném jinde (provozovatel). */
export async function sendPaidInvoice(orderId: string) {
  await sendBillingEmail(orderId, "invoice");
}

async function sendBillingEmail(orderId: string, kind: "request" | "invoice") {
  const supplier = supplierConfiguration();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!supplier || !apiKey || process.env.AUTH_EMAIL_DELIVERY_ENABLED === "false") return;
  const order = await loadOrder(orderId);
  const to = order?.billing.email;
  if (!order || !to) return;
  try {
    assertLocalEmailRecipientsAllowed([to]);
    const pdf = await generateBillingPdf(order, supplier);
    const subject = kind === "invoice" ? `Faktura Splatno ${order.invoice_number}` : `Splatno: výzva k platbě ${order.order_number}`;
    const text = kind === "invoice"
      ? `Děkujeme, platba za objednávku ${order.order_number} dorazila a tarif je aktivní. V příloze je faktura.`
      : `Děkujeme za objednávku ${order.order_number}. V příloze je výzva k platbě s QR kódem; tarif se aktivuje po připsání platby.`;
    await new Resend(apiKey).emails.send({
      from: process.env.AUTH_EMAIL_FROM?.trim() || "Splatno <prihlaseni@mail.splatno.cz>",
      to,
      subject,
      text,
      attachments: [{ filename: pdf.filename, content: Buffer.from(pdf.bytes) }],
    }, { idempotencyKey: `billing/${kind}/${order.id}` });
  } catch (error) {
    logError("E-mail s dokladem za předplatné se nepodařilo odeslat", error, { order_id: orderId });
  }
}

/**
 * Po skončení zkušební doby nebo předplatného nejde zakládat nové faktury.
 * Při chybě čtení nebo neznámých datech se nic neblokuje (výpadek nesmí
 * zastavit práci); vrací odpověď 402, nebo null.
 */
export async function subscriptionBlock(identity: RequestIdentity) {
  try {
    const { data, error } = await identity.service.from("subscriptions")
      .select("status, trial_ends_at, current_period_end")
      .eq("organization_id", identity.membership.organization_id)
      .maybeSingle();
    const row = data as SubscriptionRow | null;
    if (error || !row || !["trial", "active", "cancelled"].includes(row.status)) return null;
    if (subscriptionState(row) !== "expired") return null;
  } catch {
    return null;
  }
  return Response.json({
    error: "Zkušební doba nebo předplatné skončilo. Nové faktury půjde přidávat po zakoupení tarifu (Nastavení → Předplatné).",
    code: "subscription_required",
  }, { status: 402 });
}
