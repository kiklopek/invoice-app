import "server-only";

import Stripe from "stripe";
import { lookupKey, parseLookupKey, type BillingPeriod, type PlanId } from "@/lib/plans";

// Stripe pro předplatné Splatna. Klíče jsou jen na serveru; bez nich je
// předplatné vypnuté a API odpoví 503 (nic se tiše nepředstírá).
//
//   STRIPE_SECRET_KEY      sk_test_… / sk_live_…
//   STRIPE_WEBHOOK_SECRET  whsec_… (Dashboard → Developers → Webhooks)
//   STRIPE_TAX_RATE_ID     txr_… DPH 21 % (jen když je Splatno plátce DPH)

export type StripeConfiguration = { secretKey: string; webhookSecret: string; taxRateId: string | null };

export function stripeConfiguration(env: Record<string, string | undefined> = process.env): StripeConfiguration | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secretKey || !/^(sk|rk)_(test|live)_/.test(secretKey) || !webhookSecret?.startsWith("whsec_")) return null;
  const taxRateId = env.STRIPE_TAX_RATE_ID?.trim();
  return { secretKey, webhookSecret, taxRateId: taxRateId?.startsWith("txr_") ? taxRateId : null };
}

let client: { key: string; stripe: Stripe } | null = null;

export function getStripe(configuration = stripeConfiguration()) {
  if (!configuration) return null;
  if (client?.key !== configuration.secretKey) {
    client = { key: configuration.secretKey, stripe: new Stripe(configuration.secretKey, { maxNetworkRetries: 2, timeout: 20_000 }) };
  }
  return client.stripe;
}

const priceCache = new Map<string, { id: string; at: number }>();
const PRICE_TTL = 10 * 60_000;

/** Cena ve Stripe podle lookup_key (splatno_<tarif>_<období>). */
export async function priceFor(stripe: Stripe, plan: PlanId, period: BillingPeriod) {
  const key = lookupKey(plan, period);
  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.at < PRICE_TTL) return cached.id;
  const prices = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  const price = prices.data[0];
  if (!price) throw new Error(`stripe_price_missing:${key}`);
  priceCache.set(key, { id: price.id, at: Date.now() });
  return price.id;
}

export function clearPriceCache() {
  priceCache.clear();
}

/** Tarif a období z položky předplatného (podle lookup_key ceny). */
export function planOfSubscription(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0];
  return item ? parseLookupKey(item.price.lookup_key) : null;
}
