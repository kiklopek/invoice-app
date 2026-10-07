import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { supplierConfiguration, trialWarning } from "@/lib/billing";
import { loadSubscription } from "@/lib/billing-server";
import { comgateConfiguration } from "@/lib/comgate";

// Předplatné firmy pro stránku Koupit: stav, objednávky a co je k dispozici.
export async function GET() {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  const org = identity.membership.organization_id;
  const [subscription, ordersResult, companyResult] = await Promise.all([
    loadSubscription(identity.service, org),
    identity.service.from("billing_orders")
      .select("id, order_number, plan, period, gross_halere, payment_method, status, invoice_number, created_at, paid_at")
      .eq("organization_id", org).order("created_at", { ascending: false }).limit(20),
    identity.service.from("organizations").select("name, ico, dic, registered_address, email, verified_at").eq("id", org).single(),
  ]);
  const company = companyResult.data;
  return NextResponse.json({
    subscription: { ...subscription.row, state: subscription.state, warning: trialWarning(subscription.row) },
    orders: ordersResult.data ?? [],
    verified: Boolean(company?.verified_at),
    can_order: identity.membership.role === "admin",
    methods: { card: Boolean(comgateConfiguration()), transfer: Boolean(supplierConfiguration()) },
    vat_payer: supplierConfiguration()?.vatPayer ?? true,
    billing_defaults: company
      ? { name: company.name, ico: company.ico ?? "", dic: company.dic ?? "", address: company.registered_address ?? "", email: company.email ?? "" }
      : null,
  }, { headers: { "cache-control": "private, no-store" } });
}
