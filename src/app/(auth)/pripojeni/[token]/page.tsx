import type { Metadata } from "next";
import { getAuthenticatedSession, getCachedRequestIdentity } from "@/lib/auth";
import { loadNetworkInvitation, type NetworkInvitationPreview } from "@/lib/network-invitation-server";
import { NetworkInvitationClient } from "./network-invitation-client";

export const metadata: Metadata = { title: "Pozvánka do Splatno Sítě" };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ odhlasit?: string }> };

// Odkaz z pozvánky do sítě. Stránka sama nic nemění: přijetí i odhlášení
// z pozvánek dělá až POST /api/network-invitations/[token] po kliknutí.
export default async function NetworkInvitationPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { odhlasit } = await searchParams;
  let invitation: NetworkInvitationPreview | null | "unavailable";
  try {
    invitation = await loadNetworkInvitation(token);
  } catch {
    invitation = "unavailable";
  }
  const identity = await getCachedRequestIdentity().catch(() => null);
  const session = identity ? null : await getAuthenticatedSession({ requireMfa: false, requireLoginSession: false }).catch(() => null);

  return (
    <NetworkInvitationClient
      token={token}
      optOut={odhlasit === "1"}
      invitation={invitation === "unavailable" ? { state: "unavailable" } : invitation ?? { state: "invalid" }}
      viewer={identity
        ? { kind: "member", isAdmin: identity.membership.role === "admin", email: identity.membership.email }
        : session ? { kind: "no_company", email: session.email ?? "" } : { kind: "anonymous" }}
    />
  );
}
