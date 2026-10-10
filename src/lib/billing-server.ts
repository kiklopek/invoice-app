import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import { invoiceAllowance, subscriptionState, type SubscriptionRow } from "@/lib/billing";
import { apiError } from "@/lib/api-response";
import { BillingError, type BillingDeps, type Service } from "@/lib/stripe-billing";
import { getStripe, stripeConfiguration } from "@/lib/stripe";
import { canManageMembers } from "@/lib/role-access";
import { logError } from "@/lib/structured-log";

const SUBSCRIPTION_COLUMNS = "status, plan, period, trial_ends_at, trial_started_at, current_period_end, trial_invoices_used, trial_invoice_limit, trial_denied_reason, cancel_at_period_end, scheduled_plan, scheduled_period, scheduled_at, stripe_customer_id, stripe_subscription_id, billing_exempt";

export async function loadSubscription(service: Service, organizationId: string) {
  const { data, error } = await service.from("subscriptions").select(SUBSCRIPTION_COLUMNS).eq("organization_id", organizationId).maybeSingle();
  if (error) logError("Předplatné firmy se nepodařilo načíst", error);
  const row = (data ?? null) as (SubscriptionRow & Record<string, unknown>) | null;
  // Výpadek čtení nesmí firmu zamknout (dřív to zajišťovalo „bez řádku =
  // active“); databázový trigger limity hlídá znovu.
  return { row, state: error ? "active" as const : subscriptionState(row), failed: Boolean(error) };
}

/** Stripe pro API routy, nebo null, když není nastavený. */
export function billingDeps(service: Service): BillingDeps | null {
  const configuration = stripeConfiguration();
  const stripe = getStripe(configuration);
  return configuration && stripe ? { stripe, service, taxRateId: configuration.taxRateId } : null;
}

const SUBSCRIPTION_CODES = new Set(["trial_invoice_limit", "subscription_payment_required", "subscription_expired"]);

/**
 * Smí firma přidat `count` faktur? Při chybě čtení se neblokuje (výpadek
 * nesmí zastavit práci); databázový trigger limit hlídá znovu.
 */
export async function subscriptionBlock(identity: RequestIdentity, count = 1) {
  const { row, failed } = await loadSubscription(identity.service, identity.membership.organization_id);
  if (failed) return null;
  const allowance = invoiceAllowance(row);
  if (!allowance.ok) return Response.json({ error: allowance.message, code: allowance.code }, { status: 402 });
  if (allowance.remaining !== null && count > allowance.remaining) {
    return Response.json({
      error: `Ve zkušební době můžete přidat ještě ${allowance.remaining} ${allowance.remaining === 1 ? "fakturu" : allowance.remaining < 5 ? "faktury" : "faktur"}, import jich obsahuje ${count}. Zkraťte import, nebo začněte platit tarif (Nastavení → Předplatné).`,
      code: "trial_invoice_limit",
    }, { status: 402 });
  }
  return null;
}

/** Chyba z databázového triggeru (limit faktur) jako srozumitelná 402. */
export function subscriptionErrorResponse(error: { message?: string } | null | undefined) {
  if (!error?.message || !SUBSCRIPTION_CODES.has(error.message)) return null;
  const allowance = invoiceAllowance({
    status: error.message === "subscription_payment_required" ? "incomplete" : error.message === "subscription_expired" ? "canceled" : "trialing",
    trial_ends_at: null,
    current_period_end: null,
    trial_invoices_used: Number.MAX_SAFE_INTEGER,
  });
  return Response.json({ error: allowance.ok ? "Fakturu teď nejde přidat." : allowance.message, code: error.message }, { status: 402 });
}

/** Jednotná odpověď na chybu předplatného nebo Stripe. */
export function billingErrorResponse(request: Request, error: unknown) {
  if (error instanceof BillingError) {
    if (error.status >= 500) logError(`Předplatné: ${error.code}`, error);
    return apiError(request, error.message, error.status, error.code);
  }
  logError("Platební brána Stripe odpověděla chybou", error);
  return apiError(request, "Platební brána teď neodpovídá. Nic se nestrhlo; zkuste to prosím za chvíli.", 502, "stripe_error");
}

/**
 * Administrátor firmy + Stripe pro mutující routy předplatného. Původ
 * požadavku a identitu ověřuje routa sama (isSameOriginMutation,
 * getRequestIdentity), tady jen role a dostupnost Stripe.
 */
export function billingAdmin(request: Request, identity: RequestIdentity | null) {
  if (!identity) return { error: apiError(request, "Nejste přihlášený uživatel.", 401, "unauthorized") } as const;
  if (!canManageMembers(identity.membership.role)) {
    return { error: apiError(request, "Předplatné spravuje administrátor firmy.", 403, "forbidden") } as const;
  }
  const deps = billingDeps(identity.service);
  if (!deps) return { error: apiError(request, "Platby teď nejsou dostupné. Zkuste to prosím později.", 503, "billing_unavailable") } as const;
  return { identity, deps } as const;
}

export function originDenied(request: Request) {
  return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
}
