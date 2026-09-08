import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceDataProvider } from "@/components/workspace-data-provider";
import { getCachedRequestIdentity } from "@/lib/auth";
import { isDemoMode } from "@/lib/supabase-server";
import { displayName } from "@/lib/user-display";
import type { AccessProfile } from "@/lib/use-access-role";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  let cacheKey = "anonymous";
  let initialProfile: AccessProfile | null = null;

  if (isDemoMode()) {
    cacheKey = "demo";
    initialProfile = { role: "admin", name: "Demo administrátor", email: "kostihova@hlavica.cz", companyName: "R. Hlavica s.r.o." };
  } else {
    const identity = await getCachedRequestIdentity();
    if (identity) {
      const email = identity.user.email?.trim().toLowerCase() || identity.membership.email;
      const { data: organization } = await identity.service.from("organizations").select("name").eq("id", identity.membership.organization_id).single();
      cacheKey = `${identity.membership.organization_id}:${identity.user.id}`;
      initialProfile = {
        role: identity.membership.role,
        name: displayName(identity.user.user_metadata.full_name, email),
        email,
        companyName: organization?.name?.trim() || "Firma",
      };
    }
  }

  return <WorkspaceDataProvider key={cacheKey}><AppShell initialProfile={initialProfile}>{children}</AppShell></WorkspaceDataProvider>;
}
