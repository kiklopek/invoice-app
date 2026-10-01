// The issuer's address can appear in a footer or in an AI/ISDOC reading.
// Never interpret it as the customer address for automatic reminders.
//
// Blocked: the organization's own address, and any address on its own
// company domain (including subdomains). The domain comes from the e-mail in
// Settings, so this works for every organization, not one named here.
// Public mailbox providers are the exception: a sole trader on gmail.com must
// still be able to remind a customer who is also on gmail.com.
const PUBLIC_MAILBOX_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "seznam.cz", "email.cz", "post.cz", "spoluzaci.cz",
  "centrum.cz", "atlas.cz", "volny.cz", "tiscali.cz", "quick.cz", "o2active.cz",
  "outlook.com", "outlook.cz", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "gmx.com", "gmx.net", "gmx.de",
  "azet.sk", "zoznam.sk", "pobox.sk", "centrum.sk",
]);

export function isIssuerReminderAddress(
  recipient: string | null | undefined,
  issuer: { name?: string | null; email?: string | null },
) {
  const address = recipient?.trim().toLowerCase() ?? "";
  const ownAddress = issuer.email?.trim().toLowerCase() ?? "";
  if (!address.includes("@") || !ownAddress.includes("@")) return false;
  if (address === ownAddress) return true;

  const ownDomain = ownAddress.split("@")[1] ?? "";
  if (!ownDomain || PUBLIC_MAILBOX_DOMAINS.has(ownDomain)) return false;
  const domain = address.split("@")[1] ?? "";
  return domain === ownDomain || domain.endsWith(`.${ownDomain}`);
}
