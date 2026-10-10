import type { Metadata } from "next";
import { getAuthenticatedSession } from "@/lib/auth";
import { loadInvitation, type InvitationLookup } from "@/lib/invitation-server";
import { getDictionary, getLocale } from "@/i18n/server";
import { InvitationClient } from "./invitation-client";

export async function generateMetadata(): Promise<Metadata> {
  return { title: getDictionary(await getLocale()).meta.invitationTitle };
}

type Props = { params: Promise<{ token: string }> };

// Odkaz z e-mailu s pozvánkou (P7). Stránka sama nic nemění; přijetí dělá
// až POST /api/invitations/[token] po vyplnění formuláře.
export default async function InvitationPage({ params }: Props) {
  const { token } = await params;
  let invitation: InvitationLookup | { status: "unavailable" };
  try {
    invitation = await loadInvitation(token);
  } catch {
    invitation = { status: "unavailable" };
  }
  const session = await getAuthenticatedSession({ requireMfa: false, requireLoginSession: false }).catch(() => null);

  return (
    <InvitationClient
      token={token}
      invitation={invitation.status === "valid"
        ? { status: "valid", email: invitation.email, role: invitation.role, companyName: invitation.companyName, companyLogo: invitation.companyLogo, expiresAt: invitation.expiresAt }
        : { status: invitation.status }}
      signedInAs={session?.email ?? null}
    />
  );
}
