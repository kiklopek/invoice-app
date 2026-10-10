import "server-only";

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { changeKind, isBillingPeriod, findPlan, quote, TRIAL_DAYS, type BillingPeriod, type ChangeKind, type PlanChoice, type PlanId } from "@/lib/plans";
import { planOfSubscription, priceFor } from "@/lib/stripe";
import type { Database, Json } from "@/types/database";

// Předplatné Splatna nad Stripe. Pravidla:
// * Kartu firma zadá v onboardingu (Checkout v režimu setup). Teprve pak
//   vznikne předplatné: se 14denní zkušební dobou, má-li firma nárok
//   (claim_trial: IČO, otisk karty, IP), jinak až po výslovném potvrzení
//   částky -- bez něj se nic nestrhne.
// * Stav se do databáze jen zrcadlí (sync_stripe_subscription) vždy z
//   čerstvě načteného předplatného, takže nezáleží na pořadí webhooků.
// * Vyšší tarif hned s doplatkem poměrné části (always_invoice); když platba
//   neprojde, tarif se nezmění (pending_if_incomplete). Nižší tarif od
//   dalšího období přes subscription schedule.

export type Service = SupabaseClient<Database>;
export type BillingDeps = { stripe: Stripe; service: Service; taxRateId: string | null; now?: () => Date };

export class BillingError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

const TERMINAL = new Set(["canceled", "incomplete_expired"]);

const iso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);
const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : value?.id ?? null);

async function subscriptionRow(service: Service, organizationId: string) {
  const { data, error } = await service.from("subscriptions").select("*").eq("organization_id", organizationId).maybeSingle();
  if (error) throw error;
  return data;
}

// Trvalý přístup bez platby (R. Hlavica): ke Stripe se firma nedostane.
// Uložený zákazník by jinak zrcadlením přepsal trvalé předplatné na placené.
function assertNotExempt(row: { billing_exempt?: boolean | null } | null) {
  if (row?.billing_exempt) {
    throw new BillingError("billing_exempt", "Vaše firma má trvalý přístup bez platby. Kartu ani tarif není potřeba nastavovat.", 409);
  }
}

export function grossOf(choice: PlanChoice, taxRateId: string | null) {
  const price = quote(choice.plan, choice.period);
  return taxRateId ? price.grossHalere : price.netHalere;
}

/** Data pro sync_stripe_subscription z načteného předplatného. */
export function mirrorPayload(subscription: Stripe.Subscription, observedAt: Date) {
  const item = subscription.items.data[0];
  const choice = planOfSubscription(subscription);
  const schedule = subscription.schedule && typeof subscription.schedule === "object" ? subscription.schedule : null;
  const scheduledPlan = schedule?.metadata?.plan && findPlan(schedule.metadata.plan) ? schedule.metadata.plan : null;
  const scheduledPeriod = schedule?.metadata?.period && isBillingPeriod(schedule.metadata.period) ? schedule.metadata.period : null;
  const nextPhase = schedule?.phases.find((phase) => phase.start_date * 1000 > observedAt.getTime()) ?? null;
  const hasScheduledChange = Boolean(scheduledPlan && scheduledPeriod && nextPhase && schedule?.status === "active");
  return {
    customer_id: idOf(subscription.customer),
    subscription_id: subscription.id,
    status: subscription.status,
    plan: choice?.plan ?? null,
    period: choice?.period ?? null,
    trial_ends_at: iso(subscription.trial_end),
    current_period_end: iso(item?.current_period_end),
    cancel_at_period_end: subscription.cancel_at_period_end,
    scheduled_plan: hasScheduledChange ? scheduledPlan : null,
    scheduled_period: hasScheduledChange ? scheduledPeriod : null,
    scheduled_at: hasScheduledChange ? iso(nextPhase!.start_date) : null,
    observed_at: observedAt.toISOString(),
  };
}

async function organizationOf(service: Service, subscription: Stripe.Subscription) {
  const fromMetadata = subscription.metadata?.organization_id;
  if (fromMetadata) return fromMetadata;
  const customer = idOf(subscription.customer);
  if (!customer) return null;
  const { data } = await service.from("subscriptions").select("organization_id").eq("stripe_customer_id", customer).maybeSingle();
  return data?.organization_id ?? null;
}

/** Načte předplatné ze Stripe a zrcadlí ho do databáze. */
export async function syncSubscription(deps: BillingDeps, subscriptionId: string) {
  const observedAt = (deps.now ?? (() => new Date()))();
  const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId, { expand: ["schedule"] });
  const organizationId = await organizationOf(deps.service, subscription);
  if (!organizationId) throw new BillingError("organization_unknown", `Předplatné ${subscriptionId} nepatří žádné firmě.`, 500);
  const { data, error } = await deps.service.rpc("sync_stripe_subscription", {
    target_org: organizationId,
    payload: mirrorPayload(subscription, observedAt) as unknown as Json,
  });
  if (error) throw new BillingError(error.message, `Stav předplatného se nepodařilo uložit: ${error.message}`, 500);
  return { organizationId, subscription, result: data };
}

/** Zákazník ve Stripe pro firmu (jednou; jiného zákazníka nepřepíše). */
export async function ensureCustomer(deps: BillingDeps, organizationId: string) {
  const row = await subscriptionRow(deps.service, organizationId);
  if (!row) throw new BillingError("subscription_not_found", "Firma nemá založené předplatné.", 409);
  if (row.stripe_customer_id) return row.stripe_customer_id;
  const { data: organization, error } = await deps.service.from("organizations")
    .select("name, ico, dic, email").eq("id", organizationId).single();
  if (error || !organization) throw new BillingError("organization_not_found", "Firma nebyla nalezena.", 404);
  const customer = await deps.stripe.customers.create({
    name: organization.name,
    email: organization.email ?? undefined,
    preferred_locales: ["cs-CZ"],
    metadata: { organization_id: organizationId },
    invoice_settings: organization.ico ? { custom_fields: [{ name: "IČO", value: organization.ico }] } : undefined,
    tax_id_data: organization.dic && /^CZ\d{8,10}$/.test(organization.dic) ? [{ type: "eu_vat", value: organization.dic }] : undefined,
  }, { idempotencyKey: `splatno-customer-${organizationId}` });
  const { error: linkError } = await deps.service.rpc("link_stripe_customer", { target_org: organizationId, customer_id: customer.id });
  if (linkError) throw new BillingError(linkError.message, "Zákazníka ve Stripe se nepodařilo propojit s firmou.", 500);
  return customer.id;
}

/**
 * Checkout pro uložení karty. Částka se tu nestrhává; tarif si firma vybrala
 * a uloží se k předplatnému, aby šel použít i po návratu z brány.
 */
export async function startCardSetup(deps: BillingDeps, input: {
  organizationId: string;
  choice: PlanChoice;
  ipHash: string | null;
  returnBase: string;
  returnPath: "/onboarding" | "/predplatne";
}) {
  const row = await subscriptionRow(deps.service, input.organizationId);
  if (!row) throw new BillingError("subscription_not_found", "Firma nemá založené předplatné.", 409);
  assertNotExempt(row);
  if (row.stripe_subscription_id && !TERMINAL.has(row.status)) {
    throw new BillingError("already_subscribed", "Předplatné už běží. Kartu změníte v Nastavení → Předplatné → Karta a faktury.", 409);
  }
  const { error } = await deps.service.from("subscriptions")
    .update({ plan: input.choice.plan, period: input.choice.period, updated_at: new Date().toISOString() })
    .eq("organization_id", input.organizationId);
  if (error) throw error;
  const customer = await ensureCustomer(deps, input.organizationId);
  const session = await deps.stripe.checkout.sessions.create({
    mode: "setup",
    customer,
    currency: "czk",
    locale: "cs",
    success_url: `${input.returnBase}${input.returnPath}?platba=hotovo&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.returnBase}${input.returnPath}?platba=zrusena`,
    metadata: {
      organization_id: input.organizationId,
      plan: input.choice.plan,
      period: input.choice.period,
      ip_hash: input.ipHash ?? "",
    },
    setup_intent_data: { metadata: { organization_id: input.organizationId } },
  });
  if (!session.url) throw new BillingError("checkout_unavailable", "Platební brána teď nevrátila odkaz.", 502);
  return session.url;
}

export type ActivationResult =
  | { status: "pending" }
  | { status: "subscribed"; subscriptionStatus: string }
  | { status: "trial_denied"; reason: string; choice: PlanChoice; dueNowHalere: number };

function choiceFrom(plan: unknown, period: unknown): PlanChoice | null {
  return typeof plan === "string" && findPlan(plan) && isBillingPeriod(period) ? { plan: plan as PlanId, period } : null;
}

/**
 * Po uložení karty (návrat z brány i webhook checkout.session.completed;
 * smí proběhnout víckrát). Se zkušební dobou založí předplatné hned, bez
 * nároku jen zapíše důvod a čeká na potvrzení částky (startPaidSubscription).
 */
export async function activateFromSetupSession(deps: BillingDeps, sessionId: string, expectedOrganization: string | null): Promise<ActivationResult> {
  const session = await deps.stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent.payment_method"] });
  const organizationId = session.metadata?.organization_id ?? "";
  if (!organizationId || (expectedOrganization && organizationId !== expectedOrganization)) {
    throw new BillingError("session_mismatch", "Platební relace nepatří této firmě.", 403);
  }
  if (session.mode !== "setup") throw new BillingError("session_mode", "Neočekávaný typ platební relace.", 400);
  if (session.status !== "complete") return { status: "pending" };

  const row = await subscriptionRow(deps.service, organizationId);
  if (!row) throw new BillingError("subscription_not_found", "Firma nemá založené předplatné.", 409);
  assertNotExempt(row);
  const customer = idOf(session.customer);
  if (!customer || customer !== row.stripe_customer_id) {
    throw new BillingError("customer_mismatch", "Platební relace patří jinému zákazníkovi. Nic se nestrhlo; kontaktujte podporu.", 409);
  }
  if (row.stripe_subscription_id && !TERMINAL.has(row.status)) {
    const synced = await syncSubscription(deps, row.stripe_subscription_id);
    return { status: "subscribed", subscriptionStatus: synced.subscription.status };
  }

  const setupIntent = session.setup_intent && typeof session.setup_intent === "object" ? session.setup_intent : null;
  const paymentMethod = setupIntent?.payment_method && typeof setupIntent.payment_method === "object" ? setupIntent.payment_method : null;
  if (!paymentMethod) throw new BillingError("payment_method_missing", "Karta se neuložila. Zkuste ji zadat znovu.", 409);
  await deps.stripe.customers.update(customer, { invoice_settings: { default_payment_method: paymentMethod.id } });

  const choice = choiceFrom(session.metadata?.plan, session.metadata?.period) ?? choiceFrom(row.plan, row.period);
  if (!choice) throw new BillingError("invalid_plan", "Vyberte tarif a období.", 400);

  // Zkušební doba jen poprvé: firma bez předplatného a bez proběhlé zkušební doby.
  const firstStart = row.status === "incomplete" && !row.trial_started_at;
  const ipHash = session.metadata?.ip_hash && /^[a-f0-9]{64}$/.test(session.metadata.ip_hash) ? session.metadata.ip_hash : null;
  const { data: verdict, error } = firstStart
    ? await deps.service.rpc("claim_trial", { target_org: organizationId, target_fingerprint: paymentMethod.card?.fingerprint ?? null, target_ip_hash: ipHash })
    : { data: "restart", error: null };
  if (error) throw new BillingError(error.message, "Nárok na zkušební dobu se nepodařilo ověřit.", 500);

  if (verdict !== "eligible") {
    await deps.service.from("subscriptions").update({
      plan: choice.plan,
      period: choice.period,
      trial_denied_reason: verdict === "restart" ? null : verdict,
      updated_at: new Date().toISOString(),
    }).eq("organization_id", organizationId);
    return { status: "trial_denied", reason: verdict ?? "unknown", choice, dueNowHalere: grossOf(choice, deps.taxRateId) };
  }

  const subscription = await deps.stripe.subscriptions.create({
    customer,
    items: [{ price: await priceFor(deps.stripe, choice.plan, choice.period) }],
    default_payment_method: paymentMethod.id,
    trial_period_days: TRIAL_DAYS,
    trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    default_tax_rates: deps.taxRateId ? [deps.taxRateId] : undefined,
    metadata: { organization_id: organizationId },
  }, { idempotencyKey: `splatno-trial-${organizationId}-${session.id}` });
  await syncSubscription(deps, subscription.id);
  return { status: "subscribed", subscriptionStatus: subscription.status };
}

/**
 * Předplatné bez zkušební doby (firma na ni nemá nárok, nebo obnovuje po
 * zrušení). Volá se jen po potvrzení částky uživatelem. Když banka chce
 * ověření (3-D Secure), vrátí odkaz na stránku faktury ve Stripe.
 */
export async function startPaidSubscription(deps: BillingDeps, organizationId: string) {
  const row = await subscriptionRow(deps.service, organizationId);
  assertNotExempt(row);
  if (!row?.stripe_customer_id) throw new BillingError("card_missing", "Nejdřív zadejte kartu.", 409);
  if (row.stripe_subscription_id && !TERMINAL.has(row.status)) {
    throw new BillingError("already_subscribed", "Předplatné už běží.", 409);
  }
  const choice = choiceFrom(row.plan, row.period);
  if (!choice) throw new BillingError("invalid_plan", "Vyberte tarif a období.", 400);
  const customer = await deps.stripe.customers.retrieve(row.stripe_customer_id);
  const defaultMethod = !customer.deleted ? idOf(customer.invoice_settings?.default_payment_method ?? null) : null;
  if (!defaultMethod) throw new BillingError("card_missing", "Nejdřív zadejte kartu.", 409);
  const subscription = await deps.stripe.subscriptions.create({
    customer: row.stripe_customer_id,
    items: [{ price: await priceFor(deps.stripe, choice.plan, choice.period) }],
    default_payment_method: defaultMethod,
    payment_behavior: "allow_incomplete",
    default_tax_rates: deps.taxRateId ? [deps.taxRateId] : undefined,
    metadata: { organization_id: organizationId },
    expand: ["latest_invoice"],
  }, { idempotencyKey: `splatno-paid-${organizationId}-${row.plan}-${row.period}-${defaultMethod}-${row.stripe_subscription_id ?? "first"}` });
  await syncSubscription(deps, subscription.id);
  const invoice = subscription.latest_invoice && typeof subscription.latest_invoice === "object" ? subscription.latest_invoice : null;
  if (subscription.status === "incomplete") {
    return { status: "requires_action" as const, url: invoice?.hosted_invoice_url ?? null };
  }
  return { status: "subscribed" as const, subscriptionStatus: subscription.status };
}

async function liveSubscription(deps: BillingDeps, organizationId: string) {
  const row = await subscriptionRow(deps.service, organizationId);
  assertNotExempt(row);
  if (!row?.stripe_subscription_id || TERMINAL.has(row.status)) {
    throw new BillingError("no_subscription", "Firma nemá běžící předplatné.", 409);
  }
  const subscription = await deps.stripe.subscriptions.retrieve(row.stripe_subscription_id, { expand: ["schedule"] });
  const current = planOfSubscription(subscription);
  const item = subscription.items.data[0];
  if (!current || !item) throw new BillingError("unknown_price", "Předplatné má cenu, kterou Splatno nezná. Kontaktujte podporu.", 409);
  return { row, subscription, current, item };
}

export type ChangePreview = {
  kind: ChangeKind | "trial";
  dueNowHalere: number;
  nextChargeHalere: number;
  effectiveAt: string;
  prorationDate: number;
};

/** Kolik se strhne dnes a od kdy změna platí. Nic nemění. */
export async function previewChange(deps: BillingDeps, organizationId: string, target: PlanChoice): Promise<ChangePreview> {
  const { subscription, current, item } = await liveSubscription(deps, organizationId);
  const kind = changeKind(current, target);
  if (kind === "same") throw new BillingError("same_plan", "Tento tarif už máte.", 400);
  if (subscription.status === "past_due") {
    throw new BillingError("payment_failed", "Poslední platba se nezdařila. Nejdřív aktualizujte kartu v Karta a faktury.", 409);
  }
  const now = (deps.now ?? (() => new Date()))();
  const prorationDate = Math.floor(now.getTime() / 1000);
  const nextChargeHalere = grossOf(target, deps.taxRateId);
  if (subscription.status === "trialing") {
    return { kind: "trial", dueNowHalere: 0, nextChargeHalere, effectiveAt: now.toISOString(), prorationDate };
  }
  if (kind === "downgrade") {
    return { kind, dueNowHalere: 0, nextChargeHalere, effectiveAt: iso(item.current_period_end) ?? now.toISOString(), prorationDate };
  }
  const preview = await deps.stripe.invoices.createPreview({
    customer: idOf(subscription.customer) ?? undefined,
    subscription: subscription.id,
    subscription_details: {
      items: [{ id: item.id, price: await priceFor(deps.stripe, target.plan, target.period) }],
      proration_behavior: "always_invoice",
      proration_date: prorationDate,
    },
  });
  return { kind, dueNowHalere: Math.max(0, preview.amount_due), nextChargeHalere, effectiveAt: now.toISOString(), prorationDate };
}

async function releaseSchedule(deps: BillingDeps, subscription: Stripe.Subscription) {
  const schedule = subscription.schedule && typeof subscription.schedule === "object" ? subscription.schedule : null;
  if (schedule && schedule.status === "active") await deps.stripe.subscriptionSchedules.release(schedule.id);
}

/** Provede změnu tarifu podle pravidel výše. */
export async function changePlan(deps: BillingDeps, organizationId: string, target: PlanChoice, prorationDate: number) {
  const { subscription, current, item } = await liveSubscription(deps, organizationId);
  const kind = changeKind(current, target);
  if (kind === "same") throw new BillingError("same_plan", "Tento tarif už máte.", 400);
  if (subscription.status === "past_due") {
    throw new BillingError("payment_failed", "Poslední platba se nezdařila. Nejdřív aktualizujte kartu v Karta a faktury.", 409);
  }
  const price = await priceFor(deps.stripe, target.plan, target.period);

  if (subscription.status === "trialing") {
    await releaseSchedule(deps, subscription);
    await deps.stripe.subscriptions.update(subscription.id, { items: [{ id: item.id, price }], proration_behavior: "none" });
    await syncSubscription(deps, subscription.id);
    return { status: "changed" as const, kind: "trial" as const };
  }

  if (kind === "upgrade") {
    await releaseSchedule(deps, subscription);
    const updated = await deps.stripe.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price }],
      proration_behavior: "always_invoice",
      proration_date: prorationDate,
      payment_behavior: "pending_if_incomplete",
      expand: ["latest_invoice"],
    });
    await syncSubscription(deps, subscription.id);
    if (updated.pending_update) {
      const invoice = updated.latest_invoice && typeof updated.latest_invoice === "object" ? updated.latest_invoice : null;
      return { status: "payment_required" as const, kind, url: invoice?.hosted_invoice_url ?? null };
    }
    return { status: "changed" as const, kind };
  }

  // Nižší tarif nebo měsíční platba: od dalšího období, bez vracení peněz.
  const existing = subscription.schedule && typeof subscription.schedule === "object" && subscription.schedule.status === "active"
    ? subscription.schedule
    : await deps.stripe.subscriptionSchedules.create({ from_subscription: subscription.id });
  const phase = existing.phases[0];
  await deps.stripe.subscriptionSchedules.update(existing.id, {
    end_behavior: "release",
    metadata: { plan: target.plan, period: target.period },
    phases: [
      { items: [{ price: item.price.id, quantity: 1 }], start_date: phase.start_date, end_date: phase.end_date, default_tax_rates: deps.taxRateId ? [deps.taxRateId] : undefined },
      { items: [{ price, quantity: 1 }], duration: { interval: target.period === "yearly" ? "year" : "month", interval_count: 1 }, default_tax_rates: deps.taxRateId ? [deps.taxRateId] : undefined },
    ],
  });
  await syncSubscription(deps, subscription.id);
  return { status: "scheduled" as const, kind, effectiveAt: iso(item.current_period_end) };
}

/** Zruší naplánovaný přechod na nižší tarif. */
export async function cancelScheduledChange(deps: BillingDeps, organizationId: string) {
  const { subscription } = await liveSubscription(deps, organizationId);
  await releaseSchedule(deps, subscription);
  await syncSubscription(deps, subscription.id);
}

/** Ukončí zkušební dobu hned a strhne tarif (po potvrzení uživatelem). */
export async function endTrialNow(deps: BillingDeps, organizationId: string) {
  const { subscription } = await liveSubscription(deps, organizationId);
  if (subscription.status !== "trialing") throw new BillingError("not_trialing", "Zkušební doba už skončila.", 409);
  const updated = await deps.stripe.subscriptions.update(subscription.id, {
    trial_end: "now",
    proration_behavior: "none",
    payment_behavior: "allow_incomplete",
    expand: ["latest_invoice"],
  });
  await syncSubscription(deps, subscription.id);
  const invoice = updated.latest_invoice && typeof updated.latest_invoice === "object" ? updated.latest_invoice : null;
  if (updated.status === "incomplete" || updated.status === "past_due") {
    return { status: "payment_required" as const, url: invoice?.hosted_invoice_url ?? null };
  }
  return { status: "changed" as const };
}

/** Zrušení ke konci období (nebo jeho odvolání). */
export async function setCancelAtPeriodEnd(deps: BillingDeps, organizationId: string, cancel: boolean) {
  const { subscription } = await liveSubscription(deps, organizationId);
  if (cancel) await releaseSchedule(deps, subscription);
  await deps.stripe.subscriptions.update(subscription.id, { cancel_at_period_end: cancel });
  await syncSubscription(deps, subscription.id);
}

/** Stripe portál: karta a faktury. */
export async function billingPortalUrl(deps: BillingDeps, organizationId: string, returnUrl: string) {
  const row = await subscriptionRow(deps.service, organizationId);
  assertNotExempt(row);
  if (!row?.stripe_customer_id) throw new BillingError("card_missing", "Firma zatím nemá uloženou kartu.", 409);
  const session = await deps.stripe.billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: returnUrl, locale: "cs" });
  return session.url;
}

export type { BillingPeriod };
