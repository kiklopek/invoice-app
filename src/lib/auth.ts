import "server-only";

import { cache } from "react";

import { isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { hasVerifiedEmailMfa } from "@/lib/email-mfa-server";
import { hasServerLoginSession } from "@/lib/login-session-server";
import { createServiceClient, createUserServerClient } from "@/lib/supabase-server";
import { isAccessRole } from "@/lib/role-access";
import { canClaimInvitation } from "@/lib/invitation-claim";
import { measureServerOperation } from "@/lib/server-timing";
import { logInfo } from "@/lib/structured-log";
export { canManageInvoices } from "@/lib/role-access";

type IdentityOptions = {
  requireMfa?: boolean;
  requireLoginSession?: boolean;
  accessToken?: string | null;
  diagnosticRequestId?: string;
};

// Ověřená relace: platné přihlášení, aktivní relace prohlížeče a (pokud se
// vyžaduje) 2FA. Firmu zatím neřeší -- zakladatel ji před onboardingem nemá,
// a přesto musí projít 2FA a onboardingem. Data firmy smí číst jen to, co
// prošlo getRequestIdentity (tedy i členstvím).
export async function getAuthenticatedSession(options: IdentityOptions = {}) {
  const {
    requireMfa = true,
    requireLoginSession = true,
    accessToken = null,
    diagnosticRequestId,
  } = options;
  // Fixed reason codes only: never log credentials, provider messages or PII.
  const rejectSession = (reason: string, authError?: { code?: string; status?: number; name?: string } | null) => {
    if (diagnosticRequestId) {
      logInfo("auth_session_rejected", {
        request_id: diagnosticRequestId,
        reason,
        auth_code: authError?.code,
        auth_status: authError?.status,
        auth_error_type: authError?.name,
        token_source: accessToken ? "bearer" : "cookie",
      });
    }
    return null;
  };
  const cookieAuth = await createUserServerClient();
  const service = createServiceClient();
  // Immediately after signInWithPassword the browser owns a verified token,
  // but its SSR cookie may not yet be visible to the first Route Handler
  // request in every browser. The bootstrap endpoints therefore pass that
  // token explicitly. Both calls below validate it against Supabase; no claim
  // from the browser is trusted without verification.
  const auth = accessToken ? service : cookieAuth;
  const { data: claimsData, error: claimsError } = await measureServerOperation("claims", async () => accessToken
    ? await auth.auth.getClaims(accessToken)
    : await auth.auth.getClaims());
  if (claimsError || !claimsData?.claims?.sub) return rejectSession("invalid_claims", claimsError);
  const { data, error } = await measureServerOperation("auth_user", async () => accessToken
    ? await auth.auth.getUser(accessToken)
    : await auth.auth.getUser());
  if (error || !data.user) return rejectSession("auth_user_rejected", error);
  if (claimsData.claims.sub !== data.user.id) return rejectSession("subject_mismatch");

  const email = normalizeEmail(data.user.email);
  if (!isValidEmail(email)) return rejectSession("invalid_email");

  const sessionId = typeof claimsData.claims.session_id === "string" ? claimsData.claims.session_id : null;
  if (!sessionId) return rejectSession("missing_session_id");

  // Tyhle tři dotazy na sobě nezávisí -- stojí jen na userId, e-mailu a
  // sessionId, které jsou známé už teď. Sériově to byla tři kola na server
  // navíc před KAŽDÝM požadavkem.
  //
  // Co se NEMĚNÍ: obě kontroly musí dál projít a teprve potom se smí sáhnout
  // na členství. Paralelně běží jen ČTENÍ; zápis, který přebírá pozvánku (a
  // tedy váže identitu na organizaci), zůstává v resolveMembership až za
  // oběma kontrolami.
  //
  // Routine cookie-based reads use the signed-in client so RLS remains the
  // primary organization boundary. During the short bootstrap path the
  // bearer token has already been verified above, so the service client may
  // perform the equivalent membership lookup before the cookie is visible.
  const membershipClient = accessToken ? service : cookieAuth;
  const [hasLoginSession, hasMfa, boundMembershipResult] = await Promise.all([
    requireLoginSession ? hasServerLoginSession({ userId: data.user.id, sessionId }) : Promise.resolve(true),
    requireMfa ? hasVerifiedEmailMfa({ email, userId: data.user.id, sessionId }) : Promise.resolve(true),
    measureServerOperation("membership", () => membershipClient
      .from("organization_members")
      .select("id, organization_id, role, email, support_expires_at, support_reason")
      .eq("user_id", data.user.id)
      .eq("email", email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()),
  ]);
  if (!hasLoginSession) return rejectSession("missing_login_session");
  if (!hasMfa) return rejectSession("missing_mfa");

  return {
    user: data.user,
    email,
    sessionId,
    service,
    userClient: cookieAuth,
    boundMembership: boundMembershipResult.data,
  };
}

export type AuthenticatedSession = NonNullable<Awaited<ReturnType<typeof getAuthenticatedSession>>>;

export async function getRequestIdentity(options: IdentityOptions = {}) {
  const session = await getAuthenticatedSession(options);
  if (!session) return null;
  return resolveMembership(session);
}

// Členství ve firmě. Kontroly přihlášení a 2FA už proběhly; teprve teď se
// smí zapsat převzetí pozvánky.
export async function resolveMembership(session: AuthenticatedSession) {
  const { user, email, sessionId, service, userClient: cookieAuth } = session;
  let membership = session.boundMembership;
  if (!membership) {
    const { data: invitation } = await service
      .from("organization_members")
      .select("id, organization_id, role, email, invite_expires_at")
      .is("user_id", null)
      .eq("email", email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (invitation && canClaimInvitation(user, invitation)) {
      const { data: claimed } = await service
        .from("organization_members")
        .update({ user_id: user.id, email, invite_token_hash: null, invite_expires_at: null })
        .eq("id", invitation.id)
        .is("user_id", null)
        .select("id, organization_id, role, email, support_expires_at, support_reason")
        .maybeSingle();
      membership = claimed;
    }
  }

  if (!membership || !isAccessRole(membership.role)) return null;
  // Support provozovatele: dočasné členství. Prošlé se hned ukončí (RLS ho už
  // neuzná, ale aplikace čte servisním klientem).
  const supportExpiresAt = membership.support_expires_at ?? null;
  if (supportExpiresAt && new Date(supportExpiresAt) <= new Date()) {
    await service.rpc("end_support_session", { operator_user: user.id, ended_by_user: null });
    return null;
  }
  const support = supportExpiresAt
    ? { expiresAt: supportExpiresAt, reason: membership.support_reason ?? "" }
    : null;
  return {
    user,
    support,
    membership: { id: membership.id, organization_id: membership.organization_id, email: membership.email, role: membership.role },
    service,
    userClient: cookieAuth,
    sessionId,
  };
}

/**
 * Request-scoped identity for Server Components and shared page loaders.
 * React clears this memo between requests, so credentials are never shared
 * between users while nested loaders avoid repeating the same auth work.
 */
export const getCachedAuthenticatedSession = cache(() => getAuthenticatedSession());
export const getCachedRequestIdentity = cache(async () => {
  const session = await getCachedAuthenticatedSession();
  return session ? resolveMembership(session) : null;
});

export type RequestIdentity = NonNullable<Awaited<ReturnType<typeof getRequestIdentity>>>;
