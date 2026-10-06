import "server-only";

import { cache } from "react";

import { isAllowedCorporateEmail, normalizeEmail } from "@/lib/auth-policy";
import { hasVerifiedEmailMfa } from "@/lib/email-mfa-server";
import { hasServerLoginSession } from "@/lib/login-session-server";
import { createServiceClient, createUserServerClient } from "@/lib/supabase-server";
import { isAccessRole } from "@/lib/role-access";
export { canManageInvoices } from "@/lib/role-access";

type IdentityOptions = {
  requireMfa?: boolean;
  requireLoginSession?: boolean;
  accessToken?: string | null;
};

export async function getRequestIdentity(options: IdentityOptions = {}) {
  const {
    requireMfa = true,
    requireLoginSession = true,
    accessToken = null,
  } = options;
  const cookieAuth = await createUserServerClient();
  const service = createServiceClient();
  // Immediately after signInWithPassword the browser owns a verified token,
  // but its SSR cookie may not yet be visible to the first Route Handler
  // request in every browser. The bootstrap endpoints therefore pass that
  // token explicitly. Both calls below validate it against Supabase; no claim
  // from the browser is trusted without verification.
  const auth = accessToken ? service : cookieAuth;
  const { data: claimsData, error: claimsError } = accessToken
    ? await auth.auth.getClaims(accessToken)
    : await auth.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) return null;
  const claims = claimsData.claims;
  const userId = claims.sub;

  const sessionId = typeof claims.session_id === "string" ? claims.session_id : null;
  if (!sessionId) return null;

  // Tyhle tři dotazy na sobě nezávisí -- stojí jen na userId, e-mailu a
  // sessionId, které jsou známé už teď. Sériově to byla tři kola na server
  // navíc před KAŽDÝM požadavkem, a getRequestIdentity() běží na všech
  // routách i ve všech page-data loaderech.
  //
  // Co se NEMĚNÍ: obě kontroly musí dál projít a teprve potom se smí sáhnout
  // na členství. Paralelně běží jen ČTENÍ; zápis, který přebírá pozvánku (a
  // tedy váže identitu na organizaci), zůstává až za oběma kontrolami --
  // jinak by si účet nepotvrzený přes MFA mohl tiše zabrat pozvánku.
  //
  // Routine cookie-based reads use the signed-in client so RLS remains the
  // primary organization boundary. During the short bootstrap path the
  // bearer token has already been verified above, so the service client may
  // perform the equivalent membership lookup before the cookie is visible.
  const membershipClient = accessToken ? service : cookieAuth;
  const readChecks = (email: string) => Promise.all([
    requireLoginSession ? hasServerLoginSession({ userId, sessionId }) : Promise.resolve(true),
    requireMfa ? hasVerifiedEmailMfa({ email, userId, sessionId }) : Promise.resolve(true),
    membershipClient
      .from("organization_members")
      .select("id, organization_id, role, email")
      .eq("user_id", userId)
      .eq("email", email)
      .limit(1)
      .maybeSingle(),
  ]);

  // getUser() je síťové kolo na Supabase Auth (~70 ms), kdežto getClaims()
  // ověřuje podpis ES256 lokálně. getUser() se přesto NESMÍ vynechat: je to
  // jediná kontrola, která pozná token odvolaný na serveru (odhlášení,
  // zablokovaný účet) -- přihlašovací session je jen podepsaná cookie.
  // Běží proto souběžně se čteními výše, která stojí na podpisem ověřených
  // claims. Nic se nerozhodne ani nezapíše, dokud getUser() neprojde.
  const tokenEmail = normalizeEmail(typeof claims.email === "string" ? claims.email : null);
  const [{ data, error }, tokenChecks] = await Promise.all([
    accessToken ? auth.auth.getUser(accessToken) : auth.auth.getUser(),
    readChecks(tokenEmail),
  ]);
  if (error || !data.user || userId !== data.user.id) return null;

  const email = normalizeEmail(data.user.email);
  if (!isAllowedCorporateEmail(email)) return null;

  // Token nese e-mail z okamžiku vydání; po změně e-mailu platí ten starý až
  // do obnovení. Rozhoduje e-mail ze serveru, čtení se pak zopakují s ním.
  const [hasLoginSession, hasMfa, boundMembershipResult] =
    email === tokenEmail ? tokenChecks : await readChecks(email);

  if (!hasLoginSession) return null;
  if (!hasMfa) return null;

  let membership = boundMembershipResult.data;
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
    userClient: cookieAuth,
    sessionId,
  };
}

/**
 * Request-scoped identity for Server Components and shared page loaders.
 * React clears this memo between requests, so credentials are never shared
 * between users while nested loaders avoid repeating the same auth work.
 */
export const getCachedRequestIdentity = cache(() => getRequestIdentity());

export type RequestIdentity = NonNullable<Awaited<ReturnType<typeof getRequestIdentity>>>;
