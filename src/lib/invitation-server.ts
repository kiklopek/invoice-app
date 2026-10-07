import "server-only";

import { Resend } from "resend";
import { assertLocalEmailRecipientsAllowed } from "@/lib/local-email-allowlist";
import { getPasswordRecoveryBaseUrl } from "@/lib/password-recovery-server";
import type { RequestIdentity } from "@/lib/auth";
import {
  createInvitationToken,
  hashInvitationToken,
  isInvitationToken,
  invitationExpiry,
  invitationUrl,
  renderInvitationEmail,
} from "@/lib/invitations";
import { displayName } from "@/lib/user-display";
import { isAccessRole, type AccessRole } from "@/lib/role-access";
import { createServiceClient } from "@/lib/supabase-server";
import { logError } from "@/lib/structured-log";
import { consumePublicAuthLimit } from "@/lib/auth-rate-limit";

const DEFAULT_AUTH_FROM = "Splatno <prihlaseni@mail.splatno.cz>";

export type InvitationDelivery =
  | { sent: true; expiresAt: string }
  | { sent: false; reason: "not_configured" | "delivery_failed" | "issue_failed"; message?: string };

// Vydá nový odkaz pozvánky (starý tím přestane platit) a pošle ho e-mailem.
// invite_sent_at se zapíše až po potvrzení od poskytovatele, takže admin
// nikdy neuvidí „odesláno“ u e-mailu, který neodešel.
export async function issueAndSendInvitation(identity: RequestIdentity, memberId: string): Promise<InvitationDelivery> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (process.env.AUTH_EMAIL_DELIVERY_ENABLED === "false" || !apiKey) {
    return { sent: false, reason: "not_configured" };
  }

  const { token, hash } = createInvitationToken();
  const expiresAt = invitationExpiry();
  const { data, error } = await identity.service.rpc("issue_organization_invitation", {
    target_org: identity.membership.organization_id,
    target_member: memberId,
    actor_user: identity.user.id,
    token_hash: hash,
    expires_at: expiresAt.toISOString(),
  });
  const issued = data as { email?: string; role?: string } | null;
  if (error || !issued?.email || !isAccessRole(issued.role)) {
    return { sent: false, reason: "issue_failed", message: error?.message };
  }

  const { data: organization } = await identity.service
    .from("organizations")
    .select("name")
    .eq("id", identity.membership.organization_id)
    .single();
  const email = renderInvitationEmail({
    companyName: organization?.name?.trim() || "Vaše firma",
    inviterName: displayName(identity.user.user_metadata.full_name, identity.membership.email),
    role: issued.role,
    url: invitationUrl(getPasswordRecoveryBaseUrl(), token),
    expiresAt,
  });

  try {
    assertLocalEmailRecipientsAllowed([issued.email]);
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: process.env.AUTH_EMAIL_FROM?.trim() || DEFAULT_AUTH_FROM,
      to: issued.email,
      replyTo: identity.membership.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }, { idempotencyKey: `invitation/${memberId}/${hash.slice(0, 16)}` });
    if (result.error || !result.data?.id) throw new Error(result.error?.name ?? "INVITATION_EMAIL_FAILED");
  } catch (deliveryError) {
    logError("Odeslání pozvánky selhalo", deliveryError, { member_id: memberId });
    return { sent: false, reason: "delivery_failed" };
  }

  await identity.service
    .from("organization_members")
    .update({ invite_sent_at: new Date().toISOString() })
    .eq("id", memberId)
    .eq("organization_id", identity.membership.organization_id)
    .eq("invite_token_hash", hash);
  return { sent: true, expiresAt: expiresAt.toISOString() };
}

// Odeslání pozvánky má vlastní denní limit na firmu, aby se z aplikace
// nedalo rozesílat neomezené množství e-mailů cizím lidem.
export async function sendInvitation(request: Request, identity: RequestIdentity, memberId: string): Promise<InvitationDelivery> {
  try {
    if (!await consumePublicAuthLimit(request, "invitation_send", `org:${identity.membership.organization_id}`)) {
      return { sent: false, reason: "delivery_failed", message: "rate_limited" };
    }
  } catch (error) {
    logError("Limit pozvánek se nepodařilo ověřit", error);
    return { sent: false, reason: "delivery_failed" };
  }
  return issueAndSendInvitation(identity, memberId);
}

export type InvitationLookup =
  | { status: "valid"; memberId: string; email: string; role: AccessRole; companyName: string; companyLogo: string | null; expiresAt: string; tokenHash: string }
  | { status: "invalid" | "expired" };

// Pozvánka podle odkazu. Neplatný tvar tokenu se do databáze vůbec nepošle.
export async function loadInvitation(token: string): Promise<InvitationLookup> {
  if (!isInvitationToken(token)) return { status: "invalid" };
  const tokenHash = hashInvitationToken(token);
  const service = createServiceClient();
  const { data, error } = await service
    .from("organization_members")
    .select("id, email, role, user_id, invite_expires_at, organizations(name, logo_path)")
    .eq("invite_token_hash", tokenHash)
    .maybeSingle();
  if (error) {
    logError("Načtení pozvánky selhalo", error);
    throw error;
  }
  if (!data || data.user_id || !data.invite_expires_at || !isAccessRole(data.role)) return { status: "invalid" };
  if (new Date(data.invite_expires_at).getTime() <= Date.now()) return { status: "expired" };
  const organization = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations;
  return {
    status: "valid",
    memberId: data.id,
    email: data.email,
    role: data.role,
    companyName: organization?.name?.trim() || "Firma",
    companyLogo: organization?.logo_path ?? null,
    expiresAt: data.invite_expires_at,
    tokenHash,
  };
}
