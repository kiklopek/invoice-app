import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { displayName } from "@/lib/user-display";
import { apiError } from "@/lib/api-response";
import { isEmailMfaBypassed } from "@/lib/email-mfa-core";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
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
    mfa_bypassed: isEmailMfaBypassed(email),
  });
}
