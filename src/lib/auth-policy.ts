import { CUSTOM_ENTRY } from "@/lib/tenant-entries";

// Splatno je pro všechny firmy: přihlásit a zaregistrovat se jde s jakýmkoli
// platným e-mailem. Doménu hlídá konkrétní firma (organizations.
// allowed_email_domain) při pozvání člena; R. Hlavica ji má nastavenou na
// hlavica.cz. Tahle konstanta slouží už jen vstupu splatno.cz/hlavica
// (nápověda ve formuláři).
export const CUSTOM_ENTRY_EMAIL_DOMAIN = CUSTOM_ENTRY.emailDomain;

export function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function isValidEmail(value: string | null | undefined) {
  const email = normalizeEmail(value);
  if (!email || email.length > 254) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/i.test(local)) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) &&
    /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(labels.at(-1)!);
}

/** Firma bez nastavené domény přijme kohokoli; jinak musí doména sedět přesně. */
export function emailMatchesDomain(value: string | null | undefined, domain: string | null | undefined) {
  if (!domain) return true;
  return normalizeEmail(value).split("@")[1] === domain.toLowerCase();
}

// Jednorázové schránky, ze kterých se zakládají účty kvůli opakované
// zkušební době. Nejde o úplný seznam: hlavní ochrana je jedna zkušební doba
// na IČO a na kartu (claim_trial); tohle jen odfiltruje nejlevnější pokusy.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com",
  "10minutemail.net", "tempmail.com", "temp-mail.org", "tempmail.dev", "tmpmail.org", "yopmail.com",
  "yopmail.net", "trashmail.com", "trashmail.de", "getnada.com", "dispostable.com", "maildrop.cc",
  "mailnesia.com", "mohmal.com", "throwawaymail.com", "fakeinbox.com", "emailondeck.com",
  "mintemail.com", "mailcatch.com", "spamgourmet.com", "burnermail.io", "1secmail.com",
]);

export function isDisposableEmail(email: string | null | undefined) {
  const domain = normalizeEmail(email).split("@")[1] ?? "";
  if (!domain) return false;
  const parts = domain.split(".");
  return parts.some((_, index) => DISPOSABLE_DOMAINS.has(parts.slice(index).join(".")));
}
