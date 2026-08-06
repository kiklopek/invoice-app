import "server-only";

import { createServiceClient, createUserServerClient } from "@/lib/supabase-server";

export async function getRequestIdentity() {
  const auth = await createUserServerClient();
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user) return null;

  const service = createServiceClient();
  const email = data.user.email?.trim().toLowerCase() ?? "";
  const { data: boundMembership } = await service
    .from("organization_members")
    .select("id, organization_id, role, email")
    .eq("user_id", data.user.id)
    .limit(1)
    .maybeSingle();

  let membership = boundMembership;
  if (!membership && email) {
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
