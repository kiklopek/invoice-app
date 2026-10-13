import "server-only";

import { Resend } from "resend";
import type { RequestIdentity } from "@/lib/auth";
import { assertLocalEmailRecipientsAllowed } from "@/lib/local-email-allowlist";
import {
  createNetworkInvitationToken,
  hashNetworkInvitationToken,
  isNetworkInvitationToken,
  networkInvitationExpiry,
  networkInvitationOptOutUrl,
  networkInvitationUrl,
  renderNetworkInvitationEmail,
} from "@/lib/network-invitations";
import { networkErrorMessage } from "@/lib/partner-network";
import { getPasswordRecoveryBaseUrl } from "@/lib/password-recovery-server";
import { createServiceClient } from "@/lib/supabase-server";
import { logError } from "@/lib/structured-log";

const DEFAULT_AUTH_FROM = "Splatno <prihlaseni@mail.splatno.cz>";

export type NetworkInvitationDelivery =
  | { sent: true; email: string }
  | { sent: false; status: number; code: string; message: string };

// Vydá pozvánku (databáze hlídá limity, opt-out a to, že firma ve Splatnu ještě
// není) a pošle ji e-mailem. sent_at se zapíše až po potvrzení od Resendu.
export async function issueAndSendNetworkInvitation(identity: RequestIdentity, ico: string, email: string): Promise<NetworkInvitationDelivery> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (process.env.AUTH_EMAIL_DELIVERY_ENABLED === "false" || !apiKey) {
    return { sent: false, status: 503, code: "email_not_configured", message: "Odesílání e-mailů není nastavené. Zkuste to prosím později." };
  }

  const { token, hash } = createNetworkInvitationToken();
  const { data, error } = await identity.service.rpc("network_issue_invitation", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
    target_ico: ico,
    target_email: email,
    token_hash: hash,
    expires_at: networkInvitationExpiry().toISOString(),
  });
  if (error) {
    const known = networkErrorMessage(error.message);
    if (known) return { sent: false, status: known.status, code: known.code, message: known.message };
    logError("Pozvánku do sítě se nepodařilo vydat", error);
    return { sent: false, status: 500, code: "network_invitation_issue_failed", message: "Pozvánku se nepodařilo připravit." };
  }
  const issued = data as { invitation_id: string; inviter_name: string; invitee_email: string; open_count: number } | null;
  if (!issued?.invitation_id) {
    return { sent: false, status: 500, code: "network_invitation_issue_failed", message: "Pozvánku se nepodařilo připravit." };
  }

  const { data: organization } = await identity.service.from("organizations")
    .select("ico").eq("id", identity.membership.organization_id).single();
  const baseUrl = getPasswordRecoveryBaseUrl();
  const message = renderNetworkInvitationEmail({
    inviterName: issued.inviter_name,
    inviterIco: organization?.ico ?? "",
    senderEmail: identity.membership.email,
    openCount: Number(issued.open_count) || 0,
    url: networkInvitationUrl(baseUrl, token),
    optOutUrl: networkInvitationOptOutUrl(baseUrl, token),
  });

  try {
    assertLocalEmailRecipientsAllowed([issued.invitee_email]);
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: process.env.AUTH_EMAIL_FROM?.trim() || DEFAULT_AUTH_FROM,
      to: issued.invitee_email,
      replyTo: identity.membership.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: { "List-Unsubscribe": `<${networkInvitationOptOutUrl(baseUrl, token)}>` },
    }, { idempotencyKey: `network-invitation/${issued.invitation_id}/${hash.slice(0, 16)}` });
    if (result.error || !result.data?.id) throw new Error(result.error?.name ?? "NETWORK_INVITATION_EMAIL_FAILED");
  } catch (deliveryError) {
    logError("Odeslání pozvánky do sítě selhalo", deliveryError, { invitation_id: issued.invitation_id });
    return { sent: false, status: 502, code: "network_invitation_delivery_failed", message: "Pozvánku se nepodařilo odeslat. Zkuste to prosím znovu." };
  }

  const { error: markError } = await identity.service.rpc("network_mark_invitation_sent", { target_invitation: issued.invitation_id });
  if (markError) logError("Odeslanou pozvánku do sítě se nepodařilo označit", markError, { invitation_id: issued.invitation_id });
  return { sent: true, email: issued.invitee_email };
}

export type NetworkInvitationPreview = {
  state: "valid" | "expired" | "accepted";
  inviter: { name: string; ico: string; logo_path: string | null };
  invitee_ico: string;
  invitee_email: string;
  expires_at: string;
  open_count: number;
};

export async function loadNetworkInvitation(token: string): Promise<NetworkInvitationPreview | null> {
  if (!isNetworkInvitationToken(token)) return null;
  const { data, error } = await createServiceClient().rpc("network_invitation_preview", {
    target_token_hash: hashNetworkInvitationToken(token),
  });
  if (error) {
    logError("Pozvánku do sítě se nepodařilo načíst", error);
    throw error;
  }
  return (data ?? null) as NetworkInvitationPreview | null;
}
