import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { billingNotice } from "@/lib/billing";
import { billingDeps, loadSubscription } from "@/lib/billing-server";
import { canManageMembers } from "@/lib/role-access";
import { stripeConfiguration } from "@/lib/stripe";

// Stav předplatného firmy pro onboarding, stránku Předplatné a pruh v aplikaci.
export async function GET() {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  const { row, state } = await loadSubscription(identity.service, identity.membership.organization_id);
  const configuration = stripeConfiguration();
  return NextResponse.json({
    subscription: row
      ? {
          status: row.status,
          state,
          plan: row.plan ?? null,
          period: row.period ?? null,
          trial_ends_at: row.trial_ends_at,
          current_period_end: row.current_period_end,
          trial_invoices_used: row.trial_invoices_used ?? 0,
          trial_invoice_limit: row.trial_invoice_limit ?? null,
          trial_denied_reason: row.trial_denied_reason ?? null,
          cancel_at_period_end: Boolean(row.cancel_at_period_end),
          scheduled_plan: row.scheduled_plan ?? null,
          scheduled_period: row.scheduled_period ?? null,
          scheduled_at: row.scheduled_at ?? null,
          has_card: Boolean(row.stripe_customer_id),
          managed_by_stripe: Boolean(row.stripe_subscription_id),
        }
      : { status: "legacy", state, managed_by_stripe: false, has_card: false },
    notice: billingNotice(row),
    can_manage: canManageMembers(identity.membership.role),
    available: Boolean(billingDeps(identity.service)),
    vat_payer: Boolean(configuration?.taxRateId),
  }, { headers: { "cache-control": "private, no-store" } });
}
