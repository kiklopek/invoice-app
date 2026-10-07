import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOperatorSession } from "@/lib/operator-server";
import { subscriptionState } from "@/lib/billing";
import { OperatorConsole, type OperatorCompany, type OperatorOrder } from "./operator-console";

export const metadata: Metadata = { title: "Provoz | Splatno", robots: { index: false } };
export const dynamic = "force-dynamic";

// Provozní stránka Splatna. Kdo není provozovatel, dostane 404 (stránka se
// neprozrazuje). Data čte servisní klient, protože jde napříč firmami.
export default async function OperatorPage() {
  const session = await getOperatorSession();
  if (!session) notFound();
  const [companies, orders, subscriptions] = await Promise.all([
    session.service.from("organizations").select("id, name, ico, email, data_box_id, verified_at, created_at").order("created_at", { ascending: false }).limit(100),
    session.service.from("billing_orders").select("id, organization_id, order_number, variable_symbol, plan, period, gross_halere, payment_method, status, created_at, billing").order("created_at", { ascending: false }).limit(100),
    session.service.from("subscriptions").select("organization_id, status, plan, period, trial_ends_at, current_period_end"),
  ]);
  const subscriptionByOrg = new Map((subscriptions.data ?? []).map((row) => [row.organization_id, row]));
  const companyRows: OperatorCompany[] = (companies.data ?? []).map((company) => {
    const sub = subscriptionByOrg.get(company.id) ?? null;
    return { ...company, subscription: sub ? `${subscriptionState(sub)}${sub.plan ? ` · ${sub.plan} ${sub.period === "yearly" ? "ročně" : "měsíčně"}` : ""}` : "bez předplatného" };
  });
  const names = new Map(companyRows.map((company) => [company.id, company.name]));
  const orderRows: OperatorOrder[] = (orders.data ?? []).map((order) => ({ ...order, company: names.get(order.organization_id) ?? "—" }));
  return <OperatorConsole operatorEmail={session.email} companies={companyRows} orders={orderRows} />;
}
