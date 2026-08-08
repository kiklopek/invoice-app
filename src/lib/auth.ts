import "server-only";

import { isAllowedCorporateEmail, normalizeEmail } from "@/lib/auth-policy";
import { createServiceClient, createUserServerClient } from "@/lib/supabase-server";

type IdentityOptions = { requireMfa?: boolean };

export async function getRequestIdentity(options: IdentityOptions = {}) {
  const { requireMfa = true } = options;
  const auth = await createUserServerClient();
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user) return null;

  const email = normalizeEmail(data.user.email);
  if (!isAllowedCorporateEmail(email)) return null;

  if (requireMfa) {
    const { data: assurance, error: assuranceError } =
      await auth.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError || assurance.currentLevel !== "aal2") return null;
  }

  const service = createServiceClient();
  const { data: boundMembership } = await service
    .from("organization_members")
    .select("id, organization_id, role, email")
    .eq("user_id", data.user.id)
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  let membership = boundMembership;
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

  if (!membership) return null;
  return { user: data.user, membership, service };
}

export function canManageInvoices(role: string) {
  return role === "accounting" || role === "admin";
}
