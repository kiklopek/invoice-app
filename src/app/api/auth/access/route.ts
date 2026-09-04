import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { isDemoMode } from "@/lib/supabase-server";
import { displayName } from "@/lib/user-display";
import { apiError } from "@/lib/api-response";
import { isEmailMfaBypassed } from "@/lib/email-mfa-core";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  }
  if (isDemoMode()) {
    return NextResponse.json({ allowed: true, role: "admin", name: "Demo administrátor", email: "kostihova@hlavica.cz", companyName: "R. Hlavica s.r.o." });
  }
  const identity = await getRequestIdentity({ requireMfa: false, requireLoginSession: false });
  if (!identity) {
    return apiError(request, "Tento účet nemá aktivní přístup do firemní aplikace.", 403, "access_denied");
  }
  const email = identity.user.email?.trim().toLowerCase() || identity.membership.email;
  const { data: organization } = await identity.service
    .from("organizations")
    .select("name")
    .eq("id", identity.membership.organization_id)
    .single();
  return NextResponse.json({
    allowed: true,
    role: identity.membership.role,
    name: displayName(identity.user.user_metadata.full_name, email),
    email,
    companyName: organization?.name?.trim() || "Firma",
    mfa_bypassed: isEmailMfaBypassed(email, identity.user.email_confirmed_at),
  });
}
