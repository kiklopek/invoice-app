import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/toast";
import { WorkspaceDataProvider } from "@/components/workspace-data-provider";
import { redirect } from "next/navigation";
import { getAuthenticatedSession, getCachedRequestIdentity } from "@/lib/auth";
import { routeFor } from "@/lib/access-state";
import { billingNotice } from "@/lib/billing";
import { loadSubscription } from "@/lib/billing-server";
import { SubscriptionBanner } from "@/components/subscription-banner";
import { SupportBanner } from "@/components/support-banner";
import { isOperatorEmail } from "@/lib/operator";
import { displayName } from "@/lib/user-display";
import type { AccessProfile } from "@/lib/use-access-role";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  let cacheKey = "anonymous";
  let initialProfile: AccessProfile | null = null;
  let notice: ReturnType<typeof billingNotice> = null;
  let support: { expiresAt: string; reason: string } | null = null;

  const identity = await getCachedRequestIdentity();
  // Ověřený účet bez firmy je zakladatel před onboardingem (P12): aplikace
  // bez firmy nemá co ukázat, pokračuje se nastavením firmy.
  const sessionWithoutCompany = identity ? null : await getAuthenticatedSession();
  // Provozovatel bez aktivního supportu patří na /provoz, ne do zakládání firmy.
  if (sessionWithoutCompany && isOperatorEmail(sessionWithoutCompany.email)) redirect("/provoz");
  if (sessionWithoutCompany) {
    const decision = routeFor("needs_onboarding", "/dashboard");
    if (decision.type === "redirect") redirect(decision.to);
  }
  if (identity) {
    const email = identity.user.email?.trim().toLowerCase() || identity.membership.email;
    const { data: organization } = await identity.service.from("organizations").select("name, logo_path").eq("id", identity.membership.organization_id).single();
    cacheKey = `${identity.membership.organization_id}:${identity.user.id}`;
    const subscription = await loadSubscription(identity.service, identity.membership.organization_id);
    // Firma bez zadané karty (P12: needs_payment) dokončí platbu v onboardingu.
    if (subscription.state === "needs_payment") {
      const decision = routeFor("needs_payment", "/dashboard");
      if (decision.type === "redirect") redirect(decision.to);
    }
    notice = billingNotice(subscription.row);
    support = identity.support;
    initialProfile = {
      role: identity.membership.role,
      name: displayName(identity.user.user_metadata.full_name, email),
      email,
      companyName: organization?.name?.trim() || "Firma",
      companyLogo: organization?.logo_path ?? null,
    };
  }

  // ToastProvider je jeden na celý workspace -- kdyby si ho připojovala každá
  // stránka zvlášť, vznikl by jedenáctý ad-hoc mechanismus hlášek.
  return (
    <WorkspaceDataProvider key={cacheKey}>
      <ToastProvider>
        <AppShell initialProfile={initialProfile}>
          <SupportBanner support={support} companyName={initialProfile?.companyName ?? "Firma"} />
          <SubscriptionBanner notice={notice} canManage={initialProfile?.role === "admin"} />
          {children}
        </AppShell>
      </ToastProvider>
    </WorkspaceDataProvider>
  );
}
