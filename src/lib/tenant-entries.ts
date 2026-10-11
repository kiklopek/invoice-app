// Firemní vstup na splatno.cz/<firma>. Jediné místo v kódu, kde smí být
// konkrétní zákazník jménem: vstup je záměrně jen pro R. Hlavica (jejich
// logo, jejich registrace jen pro pozvané @hlavica.cz). Zbytek kódu
// používá neutrální CUSTOM_ENTRY a funkce níže; jméno, logo a doména každé
// jiné firmy se berou z dat (organizations). Hlídá to tenant-exclusivity.test.ts.
export const HLAVICA_ENTRY = {
  brand: "hlavica",
  path: "/hlavica",
  name: "R. Hlavica",
  logo: "/brand/drevohlavica.png",
  emailDomain: "hlavica.cz",
} as const;

/** Jediný firemní vstup (dnes a natrvalo R. Hlavica). */
export const CUSTOM_ENTRY = HLAVICA_ENTRY;
export const CUSTOM_ENTRY_REGISTRATION_PATH = `${CUSTOM_ENTRY.path}/registrace`;
/** Parametr adresy, který nese vzhled vstupu na 2FA a obnovu hesla. */
export const CUSTOM_ENTRY_QUERY = `vstup=${CUSTOM_ENTRY.brand}`;

export type EntryBrand = "splatno" | typeof CUSTOM_ENTRY.brand;

export function isCustomEntryBrand(value: unknown): value is typeof CUSTOM_ENTRY.brand {
  return value === CUSTOM_ENTRY.brand;
}

/** Vzhled podle ?vstup=… v adrese (jen vzhled; přístup řídí členství). */
export function entryFromSearch(params: URLSearchParams): EntryBrand {
  return isCustomEntryBrand(params.get("vstup")) ? CUSTOM_ENTRY.brand : "splatno";
}

/** Odkaz, který si nese firemní vstup dál (obecný vstup nic nepřidává). */
export function withEntry(path: string, brand: EntryBrand) {
  if (!isCustomEntryBrand(brand)) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${CUSTOM_ENTRY_QUERY}`;
}

/**
 * Firma, která má vlastní vstup. Pozná se podle domény e-mailů nastavené u
 * firmy (organizations.allowed_email_domain); tu nastavuje jen migrace,
 * aplikace ji nikde nezapisuje.
 */
export function tenantEntryFor(allowedEmailDomain: string | null | undefined) {
  return allowedEmailDomain && allowedEmailDomain === CUSTOM_ENTRY.emailDomain ? CUSTOM_ENTRY : null;
}

export type RegistrationAccess =
  | { allowed: true; kind: "invited" | "signup" }
  | { allowed: false; kind: "not_invited" | "member" | "custom_entry" | "disposable" };

/**
 * Kdo se smí registrovat (čisté rozhodnutí bez databáze).
 * - Vstup firmy: jen e-mail z její domény, který předem pozvala.
 * - Obecná registrace: lidi firmy se vstupem posílá na jejich registraci,
 *   ostatní pustí a neprozradí, jestli jsou pozvaní (kam patří, se rozhodne
 *   až po potvrzení e-mailu). Zakladatel z jednorázové schránky neprojde.
 */
export function registrationAccessDecision(input: {
  entry: unknown;
  emailMatchesEntryDomain: boolean;
  invitation: { claimed: boolean; organizationDomain: string | null | undefined } | null;
  disposable: boolean;
}): RegistrationAccess {
  const invitedToEntry = tenantEntryFor(input.invitation?.organizationDomain) !== null;
  if (isCustomEntryBrand(input.entry)) {
    if (!input.emailMatchesEntryDomain || !input.invitation || !invitedToEntry) return { allowed: false, kind: "not_invited" };
    if (input.invitation.claimed) return { allowed: false, kind: "member" };
    return { allowed: true, kind: "invited" };
  }
  if (input.emailMatchesEntryDomain || invitedToEntry) return { allowed: false, kind: "custom_entry" };
  if (!input.invitation && input.disposable) return { allowed: false, kind: "disposable" };
  return { allowed: true, kind: "signup" };
}
