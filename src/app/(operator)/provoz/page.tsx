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
const PAGE_SIZE = 100;

export default async function OperatorPage({ searchParams }: { searchParams: Promise<{ strana?: string }> }) {
  const session = await getOperatorSession();
  if (!session) notFound();
  // Stránkování: dřív se ukázalo jen 200 nejnovějších firem a předplatné
  // ostatních (nad 1000 řádků) tiše vypadlo jako „bez předplatného“.
  const page = Math.max(1, Number((await searchParams).strana) || 1);
  const companies = await session.service.from("organizations").select("id, name, ico, email, created_at", { count: "exact" })
    .order("created_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const companyIds = (companies.data ?? []).map((company) => company.id);
  const subscriptions = companyIds.length
    ? await session.service.from("subscriptions").select("organization_id, status, plan, period, trial_ends_at, current_period_end, trial_invoices_used, trial_invoice_limit, trial_denied_reason, stripe_customer_id, billing_exempt").in("organization_id", companyIds)
    : { data: [] };
  const byOrg = new Map((subscriptions.data ?? []).map((row) => [row.organization_id, row]));
  const rows: OperatorCompany[] = (companies.data ?? []).map((company) => {
    const sub = byOrg.get(company.id) ?? null;
    const state = subscriptionState(sub);
    return {
      ...company,
      state: sub ? state : "bez předplatného",
      plan: sub?.billing_exempt ? "trvale zdarma" : sub?.plan ? `${findPlan(sub.plan)?.name ?? sub.plan} ${sub.period === "yearly" ? "ročně" : "měsíčně"}` : "—",
      trial: sub && state === "trial" ? `do ${date(sub.trial_ends_at)} · ${sub.trial_invoices_used}/${sub.trial_invoice_limit} faktur` : null,
      trialDenied: sub?.trial_denied_reason ?? null,
      stripeCustomer: sub?.stripe_customer_id ?? null,
    };
  });
  const testMode = stripeConfiguration()?.secretKey.startsWith("sk_test_") ?? true;
  return <OperatorConsole operatorEmail={session.email} companies={rows} stripeDashboard={`https://dashboard.stripe.com${testMode ? "/test" : ""}`}
    page={page} totalCompanies={companies.count ?? rows.length} pageSize={PAGE_SIZE} />;
}
