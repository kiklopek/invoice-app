import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOperatorSession } from "@/lib/operator-server";
import { subscriptionState } from "@/lib/billing";
import { findPlan } from "@/lib/plans";
import { stripeConfiguration } from "@/lib/stripe";
import { OperatorConsole, type OperatorCompany } from "./operator-console";

export const metadata: Metadata = { title: "Provoz | Splatno", robots: { index: false } };
export const dynamic = "force-dynamic";

const date = (value: string | null) => (value ? new Date(value).toLocaleDateString("cs-CZ") : null);

// Provozní stránka Splatna. Kdo není provozovatel, dostane 404 (stránka se
// neprozrazuje). Data čte servisní klient, protože jde napříč firmami.
export default async function OperatorPage() {
  const session = await getOperatorSession();
  if (!session) notFound();
  const [companies, subscriptions] = await Promise.all([
    session.service.from("organizations").select("id, name, ico, email, created_at").order("created_at", { ascending: false }).limit(200),
    session.service.from("subscriptions").select("organization_id, status, plan, period, trial_ends_at, current_period_end, trial_invoices_used, trial_invoice_limit, trial_denied_reason, stripe_customer_id"),
  ]);
  const byOrg = new Map((subscriptions.data ?? []).map((row) => [row.organization_id, row]));
  const rows: OperatorCompany[] = (companies.data ?? []).map((company) => {
    const sub = byOrg.get(company.id) ?? null;
    const state = subscriptionState(sub);
    return {
      ...company,
      state: sub ? state : "bez předplatného",
      plan: sub?.plan ? `${findPlan(sub.plan)?.name ?? sub.plan} ${sub.period === "yearly" ? "ročně" : "měsíčně"}` : sub && !sub.stripe_customer_id && state === "active" ? "trvalý přístup" : "—",
      trial: sub && state === "trial" ? `do ${date(sub.trial_ends_at)} · ${sub.trial_invoices_used}/${sub.trial_invoice_limit} faktur` : null,
      trialDenied: sub?.trial_denied_reason ?? null,
      stripeCustomer: sub?.stripe_customer_id ?? null,
    };
  });
  const testMode = stripeConfiguration()?.secretKey.startsWith("sk_test_") ?? true;
  return <OperatorConsole operatorEmail={session.email} companies={rows} stripeDashboard={`https://dashboard.stripe.com${testMode ? "/test" : ""}`} />;
}
