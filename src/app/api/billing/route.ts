import { apiError } from "@/lib/api-response";
import { logError, requestId } from "@/lib/structured-log";
import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { billingNotice } from "@/lib/billing";
import { billingDeps, loadSubscription } from "@/lib/billing-server";
import { canManageMembers } from "@/lib/role-access";
import { stripeConfiguration } from "@/lib/stripe";
import { readBillingDetails, readSubscriptionUsage } from "@/lib/subscription-details-server";

// Stav předplatného firmy pro onboarding, stránku Předplatné a pruh v aplikaci.
export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  const { row, state, failed } = await loadSubscription(identity.service, identity.membership.organization_id);
  if (failed) {
    logError("Předplatné se nepodařilo načíst", new Error("subscription_read_failed"), { request_id: requestId(request) });
    return apiError(request, "Nepodařilo se načíst informace o předplatném.", 503, "subscription_read_failed");
  }
  const configuration = stripeConfiguration();
  const detailed = new URL(request.url).searchParams.get("details") === "1";
  const deps = billingDeps(identity.service);
  const canManage = canManageMembers(identity.membership.role);
  const [details, usage] = detailed ? await Promise.all([
    canManage && deps && row ? readBillingDetails(deps, row) : null,
    readSubscriptionUsage(identity.service, identity.membership.organization_id, { ...row, state }),
  ]) : [undefined, undefined];
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
          billing_exempt: Boolean(row.billing_exempt),
        }
      : { status: "missing", state, managed_by_stripe: false, has_card: false, billing_exempt: false },
    notice: billingNotice(row),
    can_manage: canManage,
    available: Boolean(deps),
    vat_payer: Boolean(configuration?.taxRateId),
    ...(detailed ? { details, usage } : {}),
  }, { headers: { "cache-control": "private, no-store" } });
}
