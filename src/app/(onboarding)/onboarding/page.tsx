import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { routeFor } from "@/lib/access-state";
import { getAuthenticatedSession, resolveMembership } from "@/lib/auth";
import { loadSubscription } from "@/lib/billing-server";
import { canManageMembers } from "@/lib/role-access";
import { displayName } from "@/lib/user-display";
import { isOperatorEmail } from "@/lib/operator";
import { OnboardingClient } from "./onboarding-client";

export const metadata: Metadata = { title: "Nastavení firmy | Splatno" };

// Onboarding firmy (P5): ověřený zakladatel bez firmy projde celé nastavení;
// firma založená, ale bez karty (needs_payment), se vrátí rovnou na krok
// Tarif a karta. Kdo firmu má a platbu dokončenou, jde na nástěnku.
export default async function OnboardingPage() {
  const session = await getAuthenticatedSession();
  if (!session) redirect("/login");
  const membership = await resolveMembership(session);
  // Účet provozovatele firmu nezakládá (support musí běžet z odděleného účtu).
  if (!membership && isOperatorEmail(session.email)) redirect("/provoz");
  const accountName = displayName(session.user.user_metadata.full_name, session.email);

  if (membership) {
    const subscription = await loadSubscription(membership.service, membership.membership.organization_id);
    const decision = routeFor(subscription.state === "needs_payment" ? "needs_payment" : "member", "/onboarding");
    if (decision.type === "redirect") redirect(decision.to);
    const { data: organization } = await membership.service.from("organizations")
      .select("name").eq("id", membership.membership.organization_id).single();
    return (
      <OnboardingClient
        accountEmail={session.email}
        accountName={accountName}
        payment={{
          companyName: organization?.name ?? "Vaše firma",
          canManage: canManageMembers(membership.membership.role),
          plan: subscription.row && typeof subscription.row.plan === "string" ? subscription.row.plan : null,
          period: subscription.row && typeof subscription.row.period === "string" ? subscription.row.period : null,
        }}
      />
    );
  }

  const decision = routeFor("needs_onboarding", "/onboarding");
  if (decision.type === "redirect") redirect(decision.to);
  return <OnboardingClient accountEmail={session.email} accountName={accountName} payment={null} />;
}
