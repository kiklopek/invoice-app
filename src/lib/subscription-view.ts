import type { BillingPeriod, PlanId } from "./plans";

export type SubscriptionView = {
  status: string;
  state: "needs_payment" | "trial" | "active" | "past_due" | "expired";
  plan?: PlanId | null; period?: BillingPeriod | null;
  trial_ends_at?: string | null; current_period_end?: string | null;
  trial_invoices_used?: number; trial_invoice_limit?: number | null;
  trial_denied_reason?: string | null; cancel_at_period_end?: boolean;
  scheduled_plan?: PlanId | null; scheduled_period?: BillingPeriod | null; scheduled_at?: string | null;
  has_card: boolean; managed_by_stripe: boolean; billing_exempt: boolean;
};
export type BillingDetails = {
  pricing: { amount: number | null; currency: string; interval: string | null; intervalCount?: number; nextAmount: number | null; nextAt: string | null } | null;
  card: { brand: string; last4: string; expMonth: number; expYear: number; expired: boolean } | null;
  paymentType: string | null;
  history: { id: string; number: string | null; created: string; amount: number; currency: string; status: string | null; url: string | null; pdf: string | null }[];
  error: boolean;
};
export type UsageMetric = { key: string; label: string; used: number | null; limit: number | null; period: "month" | "trial" | "total" };
export type BillingResponse = { subscription: SubscriptionView; can_manage: boolean; available: boolean; vat_payer: boolean; details?: BillingDetails | null; usage?: { month: string; metrics: UsageMetric[] } };

export function billingDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague" }).format(new Date(value)) : "—";
}
export function billingMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("cs-CZ", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 2 }).format(amount / 100);
}
