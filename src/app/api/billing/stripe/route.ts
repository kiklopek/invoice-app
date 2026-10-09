import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError, logInfo, requestId } from "@/lib/structured-log";
import { getStripe, stripeConfiguration } from "@/lib/stripe";
import { activateFromSetupSession, BillingError, syncSubscription, type BillingDeps } from "@/lib/stripe-billing";
import { createServiceClient } from "@/lib/supabase-server";

// Webhook od Stripe. Pravost: podpis (Stripe-Signature) a tajemství
// STRIPE_WEBHOOK_SECRET. Obsah události se nebere za bernou minci: stav
// předplatného se vždy znovu načte ze Stripe a teprve ten se zrcadlí, takže
// nezáleží na pořadí ani na opakovaném doručení.

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : value?.id ?? null);

function subscriptionOf(event: Stripe.Event): string | null {
  const object = event.data.object as unknown as Record<string, unknown>;
  if (event.type.startsWith("customer.subscription.")) return (object as unknown as Stripe.Subscription).id;
  if (event.type.startsWith("invoice.")) {
    const invoice = object as unknown as Stripe.Invoice;
    return idOf(invoice.parent?.subscription_details?.subscription ?? null);
  }
  if (event.type.startsWith("subscription_schedule.")) return idOf((object as unknown as Stripe.SubscriptionSchedule).subscription);
  return null;
}

async function handle(deps: BillingDeps, event: Stripe.Event) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== "setup" || !session.metadata?.organization_id) return "ignored";
    const result = await activateFromSetupSession(deps, session.id, null);
    return result.status;
  }
  const subscriptionId = subscriptionOf(event);
  if (!subscriptionId) return "ignored";
  await syncSubscription(deps, subscriptionId);
  return "synced";
}

export async function POST(request: Request) {
  const configuration = stripeConfiguration();
  const stripe = getStripe(configuration);
  if (!configuration || !stripe) return apiError(request, "Stripe není nastavený.", 503, "billing_unavailable");
  const signature = request.headers.get("stripe-signature");
  if (!signature) return apiError(request, "Chybí podpis.", 400, "missing_signature");

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, configuration.webhookSecret);
  } catch {
    return apiError(request, "Neplatný podpis.", 400, "invalid_signature");
  }

  const service = createServiceClient();
  const { data: seen } = await service.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (seen) return NextResponse.json({ received: true, duplicate: true });

  try {
    const outcome = await handle({ stripe, service, taxRateId: configuration.taxRateId }, event);
    // Zapsat až po úspěchu: když zpracování selže, Stripe událost zopakuje.
    await service.rpc("record_stripe_event", { event_id: event.id, event_type: event.type });
    logInfo("Stripe webhook zpracován", { request_id: requestId(request), event_id: event.id, event_type: event.type, outcome });
    return NextResponse.json({ received: true });
  } catch (error) {
    // Předplatné, které Splatnu nepatří (jiný produkt na stejném účtu), nezopakuje se.
    if (error instanceof BillingError && error.code === "organization_unknown") {
      await service.rpc("record_stripe_event", { event_id: event.id, event_type: event.type });
      return NextResponse.json({ received: true, ignored: true });
    }
    logError("Stripe webhook se nepodařilo zpracovat", error, { request_id: requestId(request), event_id: event.id, event_type: event.type });
    return apiError(request, "Událost se nepodařilo zpracovat.", 500, "webhook_failed");
  }
}
