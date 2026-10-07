import { createHash, randomBytes } from "node:crypto";
import { roleNames, type AccessRole } from "@/lib/role-access";

// Pozvánka do firmy (scénář 2 v návrhu procesů). Odkaz nese náhodný token;
// v databázi je jen jeho SHA-256 otisk, takže kdo získá výpis databáze,
// odkaz si z něj nesestaví. Token je jednorázový a platí 7 dní.

export const INVITATION_TTL_DAYS = 7;

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createInvitationToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInvitationToken(token) };
}

export function isInvitationToken(value: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function invitationExpiry(now = new Date()) {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function invitationUrl(baseUrl: string, token: string) {
  return new URL(`/pozvanka/${token}`, baseUrl).toString();
}

export type InvitationStatus = "active" | "pending" | "expired" | "not_sent";

/** Co vidí admin v seznamu týmu. „Odesláno“ jen tehdy, když e-mail opravdu odešel. */
export function invitationStatus(
  member: { user_id: string | null; invite_expires_at: string | null; invite_sent_at: string | null },
  now = new Date(),
): InvitationStatus {
  if (member.user_id) return "active";
  if (!member.invite_expires_at || !member.invite_sent_at) return "not_sent";
  return new Date(member.invite_expires_at).getTime() <= now.getTime() ? "expired" : "pending";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function czechDate(value: Date) {
  return `${value.getUTCDate()}. ${value.getUTCMonth() + 1}. ${value.getUTCFullYear()}`;
}

export function renderInvitationEmail(params: {
  companyName: string;
  inviterName: string;
  role: AccessRole;
  url: string;
  expiresAt: Date;
}) {
  const company = escapeHtml(params.companyName);
  const inviter = escapeHtml(params.inviterName);
  const role = roleNames[params.role];
  const url = escapeHtml(params.url);
  const until = czechDate(params.expiresAt);
  return {
    subject: `${params.companyName} vás zve do Splatna`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#13231b"><p style="font-size:22px;font-weight:700;margin:0 0 18px">splatno</p><h1 style="font-size:24px;margin:0 0 12px">${company} vás zve do Splatna</h1><p>${inviter} vám ve firmě <b>${company}</b> vytvořil(a) přístup s rolí <b>${role}</b>. Splatno hlídá vydané faktury, platby a upomínky.</p><p style="margin:28px 0"><a href="${url}" style="display:inline-block;background:#17613f;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700">Přijmout pozvánku</a></p><p style="color:#6b776f;font-size:14px">Odkaz platí do ${until} a lze ho použít jen jednou. Pokud pozvánku nečekáte, e-mail ignorujte.</p></div>`,
    text: `${params.companyName} vás zve do Splatna\n\n${params.inviterName} vám ve firmě ${params.companyName} vytvořil(a) přístup s rolí ${role}.\n\nPřijmout pozvánku: ${params.url}\n\nOdkaz platí do ${until} a lze ho použít jen jednou. Pokud pozvánku nečekáte, e-mail ignorujte.`,
  };
}

// Odmítnutí z databázových funkcí přeložená do vět, se kterými se dá něco
// udělat. Neznámá chyba vrací null -- volající ji zaloguje jako technickou.
const INVITATION_ERRORS: Record<string, { status: number; message: string }> = {
  invalid_email: { status: 400, message: "Zadejte platnou e-mailovou adresu." },
  invalid_role: { status: 400, message: "Vyberte roli." },
  email_domain_not_allowed: { status: 400, message: "Do této firmy lze přidat jen e-maily z firemní domény." },
  member_of_other_organization: { status: 409, message: "Tento e-mail už patří do jiné firmy ve Splatnu. Jeden účet zatím může být jen v jedné firmě." },
  insufficient_permission: { status: 403, message: "Pozvánky může posílat pouze administrátor." },
  member_not_found: { status: 404, message: "Pozvánka nebyla nalezena." },
  not_pending: { status: 409, message: "Tento člověk už pozvánku přijal." },
  invitation_not_found: { status: 404, message: "Odkaz už neplatí. Požádejte administrátora o novou pozvánku." },
  invitation_expired: { status: 410, message: "Platnost pozvánky vypršela. Požádejte administrátora o novou." },
  email_mismatch: { status: 403, message: "Pozvánka je určená pro jiný e-mail." },
};

export function invitationErrorMessage(databaseMessage: string | null | undefined) {
  if (!databaseMessage) return null;
  const code = Object.keys(INVITATION_ERRORS).find((key) => databaseMessage.includes(key));
  return code ? { code, ...INVITATION_ERRORS[code] } : null;
}
