import { czechAccountToIban, isValidIban } from "./czech-payment";

// Bankovní účty firmy. Hlavní účet pro CZK a EUR je v organizations
// (bank_account_czk / bank_account_eur) -- ten jde na faktury a do QR. Další
// účty (druhý účet u jiné banky, účet v jiné měně, zahraniční IBAN) jsou v
// organization_bank_accounts: podle nich se poznají výpisy i měna výpisu.

export type OrganizationAccount = { account: string; currency: string; primary: boolean };
type PrimaryAccounts = { bank_account_czk?: string | null; bank_account_eur?: string | null };
type ExtraAccount = { account: string; currency: string };

/**
 * Jednotný tvar účtu pro porovnání: IBAN bez mezer. Český účet se převede
 * na IBAN, takže kód banky je vždy součástí (stejné číslo v jiné bance je
 * jiný účet). Neověřitelný účet (mod-11, mod-97, chybí kód banky) je null --
 * s ničím se neshoduje.
 */
export function canonicalAccount(raw: string | null | undefined): string | null {
  const value = (raw ?? "").replace(/\s/g, "").toUpperCase();
  if (!value) return null;
  if (/^[A-Z]{2}\d{2}/.test(value)) return isValidIban(value) ? value : null;
  return czechAccountToIban(value);
}

/** Účet, na který smí odběratelé platit: český účet nebo platný IBAN. */
export function isValidPaymentAccount(raw: string | null | undefined) {
  return canonicalAccount(raw) !== null;
}

export function organizationAccounts(primary: PrimaryAccounts, extra: ExtraAccount[] = []): OrganizationAccount[] {
  const accounts: OrganizationAccount[] = [];
  if (primary.bank_account_czk?.trim()) accounts.push({ account: primary.bank_account_czk.trim(), currency: "CZK", primary: true });
  if (primary.bank_account_eur?.trim()) accounts.push({ account: primary.bank_account_eur.trim(), currency: "EUR", primary: true });
  for (const item of extra) accounts.push({ account: item.account.trim(), currency: item.currency, primary: false });
  return accounts;
}

/** Který z účtů firmy je účet výpisu (null = cizí nebo neověřitelný účet). */
export function matchOrganizationAccount(statementAccount: string | null | undefined, accounts: OrganizationAccount[]) {
  const wanted = canonicalAccount(statementAccount);
  if (!wanted) return null;
  return accounts.find((item) => canonicalAccount(item.account) === wanted) ?? null;
}

/**
 * Účet pro platbu faktury v dané měně (PDF, QR, upomínka). Nikdy se
 * nepoužije účet v jiné měně: faktura v PLN s korunovým účtem by poslala
 * peníze, které banka přepočítá nebo vrátí.
 */
export function paymentAccountFor(currency: string, primary: PrimaryAccounts, extra: ExtraAccount[] = []): string | null {
  const main = currency === "CZK" ? primary.bank_account_czk : currency === "EUR" ? primary.bank_account_eur : null;
  if (main?.trim()) return main.trim();
  return extra.find((item) => item.currency === currency && isValidPaymentAccount(item.account))?.account.trim() ?? null;
}

/**
 * Účet pro platbu konkrétní faktury (PDF, QR, upomínka). Faktura si pamatuje
 * účet, který čtení z PDF našlo na jejím dokladu (payment_account); ten se
 * použije, pokud je pořád účtem firmy a je vedený v měně faktury. Jinak --
 * účet byl z Nastavení odebrán, nebo faktura žádný uložený nemá -- platí
 * výchozí účet pro měnu jako dřív (paymentAccountFor). Nikdy se nepoužije
 * účet, který firmě nepatří.
 */
export function invoicePaymentAccount(
  invoice: { currency: string; payment_account?: string | null },
  primary: PrimaryAccounts,
  extra: ExtraAccount[] = [],
): string | null {
  const stored = invoice.payment_account?.trim();
  if (stored) {
    const own = matchOrganizationAccount(stored, organizationAccounts(primary, extra));
    if (own && own.currency === invoice.currency) return own.account;
  }
  return paymentAccountFor(invoice.currency, primary, extra);
}

/**
 * Účet, který se smí uložit k nové faktuře (payment_account): jen účet firmy
 * vedený v měně faktury, a to v zápisu z Nastavení. Cokoli jiného -- cizí účet,
 * jiná měna, neověřitelné číslo -- je null a faktura platí na výchozí účet.
 */
export function ownInvoiceAccount(
  requested: unknown,
  currency: string,
  primary: PrimaryAccounts,
  extra: ExtraAccount[] = [],
): string | null {
  if (typeof requested !== "string" || !requested.trim()) return null;
  const own = matchOrganizationAccount(requested, organizationAccounts(primary, extra));
  return own && own.currency === currency ? own.account : null;
}
