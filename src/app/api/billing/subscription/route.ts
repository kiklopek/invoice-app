import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { billingAdmin, billingErrorResponse, originDenied } from "@/lib/billing-server";
import { getPasswordRecoveryBaseUrl } from "@/lib/password-recovery-server";
import { findPlan, isBillingPeriod, type PlanChoice, type PlanId } from "@/lib/plans";
import { isSameOriginMutation } from "@/lib/request-security";
import { logInfo } from "@/lib/structured-log";
import {
  billingPortalUrl,
  cancelScheduledChange,
  changePlan,
  endTrialNow,
  previewChange,
  previewTrialEnd,
  setCancelAtPeriodEnd,
  startPaidSubscription,
} from "@/lib/stripe-billing";

type Body = { action?: unknown; plan?: unknown; period?: unknown; proration_date?: unknown; confirm?: unknown };

// Akce s předplatným. Vše, co strhává peníze nebo mění tarif, vyžaduje
// confirm: true -- uživatel před tím viděl částku (náhled `preview`).
const NEEDS_CONFIRMATION = new Set(["start", "change", "end_trial", "cancel"]);

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) return originDenied(request);
  const admin = billingAdmin(request, await getRequestIdentity());
  if ("error" in admin) return admin.error ?? apiError(request, "Oprávnění se nepodařilo ověřit.", 500, "authorization_failed");
  const { deps: baseDeps, identity } = admin;
  const operationKey = request.headers.get("x-idempotency-key");
  const deps = { ...baseDeps, idempotencyKey: `billing-${identity.membership.organization_id}-${operationKey && /^[a-zA-Z0-9-]{16,80}$/.test(operationKey) ? operationKey : crypto.randomUUID()}` };
  const organizationId = identity.membership.organization_id;
  const body = (await request.json().catch(() => null) ?? {}) as Body;
  const action = typeof body.action === "string" ? body.action : "";
  if (NEEDS_CONFIRMATION.has(action) && body.confirm !== true) {
    return apiError(request, "Akci je potřeba potvrdit.", 400, "confirmation_required");
  }
  const target: PlanChoice | null = typeof body.plan === "string" && findPlan(body.plan) && isBillingPeriod(body.period)
    ? { plan: body.plan as PlanId, period: body.period }
    : null;
  const respond = async (operation: Promise<unknown>) => {
    const result = await operation;
    if (action !== "preview" && action !== "preview_end_trial") logInfo("Operace předplatného dokončena", { organization_id: organizationId, actor_user: identity.user.id, action });
    return NextResponse.json(result);
  };

  try {
    switch (action) {
      case "start":
        return await respond(startPaidSubscription(deps, organizationId));
      case "preview":
        if (!target) return apiError(request, "Vyberte tarif a období.", 400, "invalid_plan");
        return NextResponse.json(await previewChange(deps, organizationId, target));
      case "preview_end_trial":
        return NextResponse.json(await previewTrialEnd(deps, organizationId));
      case "change": {
        if (!target) return apiError(request, "Vyberte tarif a období.", 400, "invalid_plan");
        const prorationDate = typeof body.proration_date === "number" && Number.isInteger(body.proration_date)
          && Math.abs(body.proration_date - Date.now() / 1000) < 60 * 60
          ? body.proration_date
          : Math.floor(Date.now() / 1000);
        return await respond(changePlan(deps, organizationId, target, prorationDate));
      }
      case "cancel_change":
        await cancelScheduledChange(deps, organizationId);
        return await respond(Promise.resolve({ status: "changed" }));
      case "end_trial":
        return await respond(endTrialNow(deps, organizationId));
      case "cancel":
        await setCancelAtPeriodEnd(deps, organizationId, true);
        return await respond(Promise.resolve({ status: "changed" }));
      case "resume":
        await setCancelAtPeriodEnd(deps, organizationId, false);
        return await respond(Promise.resolve({ status: "changed" }));
      case "portal":
        return NextResponse.json({ url: await billingPortalUrl(deps, organizationId, `${getPasswordRecoveryBaseUrl()}/predplatne`) });
      default:
        return apiError(request, "Neznámá akce.", 400, "invalid_action");
    }
  } catch (error) {
    return billingErrorResponse(request, error);
  }
}
