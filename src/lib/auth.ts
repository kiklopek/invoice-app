import "server-only";

import { isAllowedCorporateEmail, normalizeEmail } from "@/lib/auth-policy";
import { sessionIdFromAccessToken } from "@/lib/email-mfa-core";
import { hasVerifiedEmailMfa } from "@/lib/email-mfa-server";
import { hasServerLoginSession } from "@/lib/login-session-server";
import { createServiceClient, createUserServerClient } from "@/lib/supabase-server";
import { isAccessRole } from "@/lib/role-access";
export { canManageInvoices } from "@/lib/role-access";

type IdentityOptions = { requireMfa?: boolean; requireLoginSession?: boolean };

export async function getRequestIdentity(options: IdentityOptions = {}) {
  const { requireMfa = true, requireLoginSession = true } = options;
  const auth = await createUserServerClient();
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user) return null;

  const email = normalizeEmail(data.user.email);
  if (!isAllowedCorporateEmail(email)) return null;

  const { data: sessionData } = await auth.auth.getSession();
  const sessionId = sessionIdFromAccessToken(sessionData.session?.access_token);
  if (!sessionId) return null;

  if (requireLoginSession && !await hasServerLoginSession({ userId: data.user.id, sessionId })) return null;

  if (requireMfa) {
    const verified = await hasVerifiedEmailMfa({
      email,
      emailConfirmedAt: data.user.email_confirmed_at,
      userId: data.user.id,
      sessionId,
    });
    if (!verified) return null;
  }

  // Routine membership reads use the signed-in client so RLS remains the
  // primary organization boundary. Service role is only needed to claim a
  // previously invited row whose user_id is still null.
  const { data: boundMembership } = await auth
    .from("organization_members")
    .select("id, organization_id, role, email")
    .eq("user_id", data.user.id)
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  let membership = boundMembership;
  const service = createServiceClient();
  if (!membership) {
    const { data: invitation } = await service
      .from("organization_members")
      .select("id, organization_id, role, email")
      .is("user_id", null)
      .eq("email", email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (invitation) {
      const { data: claimed } = await service
        .from("organization_members")
        .update({ user_id: data.user.id, email })
        .eq("id", invitation.id)
        .is("user_id", null)
        .select("id, organization_id, role, email")
        .maybeSingle();
      membership = claimed;
    }
  }

  if (!membership || !isAccessRole(membership.role)) return null;
  return {
    user: data.user,
    membership: { ...membership, role: membership.role },
    service,
    userClient: auth,
    sessionId,
  };
}
