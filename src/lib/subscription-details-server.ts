import "server-only";
import type Stripe from "stripe";
import type { BillingDeps, Service } from "./stripe-billing";
import type { BillingDetails, UsageMetric } from "./subscription-view";
import { findPlan, TRIAL_INVOICE_LIMIT } from "./plans";
import { logError } from "./structured-log";

const idOf = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id ?? null;
const iso = (value: number | null | undefined) => value ? new Date(value * 1000).toISOString() : null;

/** Read only: provider identifiers come exclusively from the authenticated firm's row. */
export async function readBillingDetails(deps: BillingDeps, row: { stripe_customer_id?: unknown; stripe_subscription_id?: unknown; billing_exempt?: unknown }): Promise<BillingDetails> {
  const result: BillingDetails = { pricing: null, card: null, paymentType: null, history: [], error: false };
  if (row.billing_exempt || typeof row.stripe_customer_id !== "string") return result;
  try {
    const customerId = row.stripe_customer_id;
    const [customer, subscription, invoices] = await Promise.all([
      deps.stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] }),
      typeof row.stripe_subscription_id === "string" ? deps.stripe.subscriptions.retrieve(row.stripe_subscription_id, { expand: ["default_payment_method"] }) : null,
      deps.stripe.invoices.list({ customer: customerId, limit: 10 }),
    ]);
    if (customer.deleted || (subscription && idOf(subscription.customer) !== customerId)) throw new Error("billing_customer_mismatch");
    let method: Stripe.PaymentMethod | string | null = subscription?.default_payment_method ?? customer.invoice_settings.default_payment_method;
    if (typeof method === "string") method = await deps.stripe.paymentMethods.retrieve(method);
    if (method && idOf(method.customer) !== customerId) throw new Error("billing_payment_method_mismatch");
    result.paymentType = method?.type ?? null;
    if (method?.card) {
      const card = method.card;
      const now = (deps.now ?? (() => new Date()))();
      result.card = { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year, expired: card.exp_year < now.getUTCFullYear() || (card.exp_year === now.getUTCFullYear() && card.exp_month < now.getUTCMonth() + 1) };
    }
    if (subscription) {
      const item = subscription.items.data[0];
      result.pricing = { amount: item?.price.unit_amount == null ? null : item.price.unit_amount * (item.quantity ?? 1), currency: item?.price.currency ?? subscription.currency, interval: item?.price.recurring?.interval ?? null, intervalCount: item?.price.recurring?.interval_count ?? 1, nextAmount: null, nextAt: iso(item?.current_period_end) };
      if (!subscription.cancel_at_period_end && ["active", "trialing", "past_due"].includes(subscription.status)) {
        try {
          const preview = await deps.stripe.invoices.createPreview({ customer: customerId, subscription: subscription.id });
          result.pricing.nextAmount = preview.amount_due;
          result.pricing.currency = preview.currency;
        } catch { result.error = true; }
      }
    }
    result.history = invoices.data.filter(invoice => idOf(invoice.customer) === customerId).map(invoice => ({ id: invoice.id, number: invoice.number, created: iso(invoice.created)!, amount: invoice.status === "paid" ? invoice.amount_paid : invoice.amount_due, currency: invoice.currency, status: invoice.status, url: invoice.hosted_invoice_url ?? null, pdf: invoice.invoice_pdf ?? null }));
  } catch (error) {
    logError("Čtení fakturace Stripe selhalo", error);
    return { pricing: null, card: null, paymentType: null, history: [], error: true };
  }
  return result;
}

export async function readSubscriptionUsage(service: Service, organizationId: string, row: { plan?: unknown; state: string; billing_exempt?: unknown; trial_invoices_used?: unknown; trial_invoice_limit?: unknown }, now = new Date()) {
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const [counter, customers, payments, members] = await Promise.all([
    service.from("subscriptions").select("invoice_month_start,invoice_month_used").eq("organization_id", organizationId).maybeSingle(),
    service.from("customers").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    service.from("bank_payments").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    service.from("organization_members").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
  ]);
  const data = counter.data;
  const metrics: UsageMetric[] = [
    { key: "invoices", label: "Faktury", used: row.state === "trial" ? Number(row.trial_invoices_used ?? 0) : counter.error ? null : data?.invoice_month_start && new Date(data.invoice_month_start).toISOString() === month ? data.invoice_month_used : 0, limit: row.billing_exempt ? null : row.state === "trial" ? Number(row.trial_invoice_limit ?? TRIAL_INVOICE_LIMIT) : findPlan(typeof row.plan === "string" ? row.plan : null)?.monthlyInvoiceLimit ?? null, period: row.state === "trial" ? "trial" : "month" },
    { key: "customers", label: "Zákazníci", used: customers.error ? null : customers.count ?? 0, limit: null, period: "total" },
    { key: "payments", label: "Platby", used: payments.error ? null : payments.count ?? 0, limit: null, period: "total" },
    { key: "members", label: "Uživatelé a pozvánky", used: members.error ? null : members.count ?? 0, limit: null, period: "total" },
  ];
  return { month, metrics };
}
