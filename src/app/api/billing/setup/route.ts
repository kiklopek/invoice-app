import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { authRateLimitSubject, requestIp } from "@/lib/auth-rate-limit";
import { billingAdmin, billingErrorResponse, originDenied } from "@/lib/billing-server";
import { getPasswordRecoveryBaseUrl } from "@/lib/password-recovery-server";
import { findPlan, isBillingPeriod, type PlanId } from "@/lib/plans";
import { isSameOriginMutation } from "@/lib/request-security";
import { apiError } from "@/lib/api-response";
import { startCardSetup } from "@/lib/stripe-billing";

// Uložení karty přes Stripe Checkout (nic se nestrhává). Vrací adresu brány.
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return originDenied(request);
  const admin = billingAdmin(request, await getRequestIdentity());
  if ("error" in admin) return admin.error;
  const body = await request.json().catch(() => null) as { plan?: unknown; period?: unknown; from?: unknown } | null;
  const plan = typeof body?.plan === "string" ? findPlan(body.plan) : null;
  if (!plan || !isBillingPeriod(body?.period)) return apiError(request, "Vyberte tarif a období.", 400, "invalid_plan");
  try {
    const url = await startCardSetup(admin.deps, {
      organizationId: admin.identity.membership.organization_id,
      choice: { plan: plan.id as PlanId, period: body.period },
      // Jen HMAC otisk IP (ochrana proti opakovaným zkušebním dobám).
      ipHash: authRateLimitSubject(`ip:${requestIp(request)}`),
      returnBase: getPasswordRecoveryBaseUrl(),
      returnPath: body?.from === "predplatne" ? "/predplatne" : "/onboarding",
    });
    return NextResponse.json({ url });
  } catch (error) {
    return billingErrorResponse(request, error);
  }
}
