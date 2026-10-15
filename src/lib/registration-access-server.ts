import "server-only";

import { emailMatchesDomain, isDisposableEmail } from "@/lib/auth-policy";
import { createServiceClient } from "@/lib/supabase-server";
import { CUSTOM_ENTRY, registrationAccessDecision } from "@/lib/tenant-entries";

export async function getRegistrationAccess(email: string, entry: unknown) {
  const service = createServiceClient();
  const { data, error } = await service.from("organization_members")
    .select("id, user_id, organizations(allowed_email_domain)")
    .eq("email", email).limit(1);
  if (error) throw error;
  const row = data?.[0];
  const organization = Array.isArray(row?.organizations) ? row.organizations[0] : row?.organizations;
  return registrationAccessDecision({
    entry,
    emailMatchesEntryDomain: emailMatchesDomain(email, CUSTOM_ENTRY.emailDomain),
    invitation: row ? { claimed: Boolean(row.user_id), organizationDomain: organization?.allowed_email_domain } : null,
    disposable: isDisposableEmail(email),
  });
}
