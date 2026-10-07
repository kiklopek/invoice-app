import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { routeFor } from "@/lib/access-state";
import { getAuthenticatedSession, resolveMembership } from "@/lib/auth";
import { displayName } from "@/lib/user-display";
import { OnboardingClient } from "./onboarding-client";

export const metadata: Metadata = { title: "Nastavení firmy | Splatno" };

// Onboarding firmy (P5) je jen pro ověřeného zakladatele bez firmy. Kdo
// firmu má (i pozvaný, jehož pozvánka se právě převzala), jde na nástěnku.
export default async function OnboardingPage() {
  const session = await getAuthenticatedSession();
  if (!session) redirect("/login");
  const membership = await resolveMembership(session);
  const decision = routeFor(membership ? "member" : "needs_onboarding", "/onboarding");
  if (decision.type === "redirect") redirect(decision.to);

  return (
    <OnboardingClient
      accountEmail={session.email}
      accountName={displayName(session.user.user_metadata.full_name, session.email)}
    />
  );
}
