import { HLAVICA_ENTRY } from "@/lib/tenant-entries";

// Splatno je pro všechny firmy: přihlásit a zaregistrovat se jde s jakýmkoli
// platným e-mailem. Doménu hlídá konkrétní firma (organizations.
// allowed_email_domain) při pozvání člena; R. Hlavica ji má nastavenou na
// hlavica.cz. Tahle konstanta slouží už jen vstupu splatno.cz/hlavica
// (nápověda ve formuláři).
export const HLAVICA_EMAIL_DOMAIN = HLAVICA_ENTRY.emailDomain;

export function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function isValidEmail(value: string | null | undefined) {
  const email = normalizeEmail(value);
  if (!email || email.length > 254) return false;
  const parts = email.split("@");
  return (
    parts.length === 2 &&
    Boolean(parts[0]) &&
    Boolean(parts[1]) &&
    !/\s/.test(email) &&
    !parts[1].startsWith(".") &&
    !parts[1].endsWith(".") &&
    parts[1].includes(".")
  );
}

/** Firma bez nastavené domény přijme kohokoli; jinak musí doména sedět přesně. */
export function emailMatchesDomain(value: string | null | undefined, domain: string | null | undefined) {
  if (!domain) return true;
  return normalizeEmail(value).split("@")[1] === domain.toLowerCase();
}
