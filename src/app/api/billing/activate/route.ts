import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { billingAdmin, billingErrorResponse, originDenied } from "@/lib/billing-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { activateFromSetupSession } from "@/lib/stripe-billing";

// Návrat z platební brány po uložení karty. Totéž udělá i webhook; obojí
// smí proběhnout, výsledek je stejný.
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return originDenied(request);
  const admin = billingAdmin(request, await getRequestIdentity());
  if ("error" in admin) return admin.error;
  const body = await request.json().catch(() => null) as { session?: unknown } | null;
  const session = typeof body?.session === "string" && /^cs_(test|live)_[A-Za-z0-9]+$/.test(body.session) ? body.session : null;
  if (!session) return apiError(request, "Chybí platební relace.", 400, "invalid_session");
  try {
    return NextResponse.json(await activateFromSetupSession(admin.deps, session, admin.identity.membership.organization_id));
  } catch (error) {
    return billingErrorResponse(request, error);
  }
}
