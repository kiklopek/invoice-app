import { canonicalAccount, matchOrganizationAccount, type OrganizationAccount } from "./bank-accounts";

// Účet na faktuře čtené z PDF porovnaný se VŠEMI účty firmy (hlavní CZK/EUR
// i organization_bank_accounts). Shoda v měně faktury = faktura si účet
// uloží a PDF, QR i upomínky platí na něj. Cizí účet, účet v jiné měně nebo
// víc různých účtů firmy = viditelné varování, nic se nerozhodne potichu.
//
// Každý český účet musí projít váženou mod-11 (a IBAN mod-97) přes
// canonicalAccount -- číslo, které neprojde, je špatně přečtené a zahodí se.

const ACCOUNT_CONTEXT = /(účet|ucet|účtu|uctu|bankovn\w*\s+spojen|iban|č\.\s?ú\.|c\.\s?u\.)/i;
const CZECH_ACCOUNT = /(?<![\d-])(?:(\d{1,6})-)?(\d{2,10})\s?\/\s?(\d{4})(?!\d)/g;
const IBAN_START = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?/g;

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = canonicalAccount(value) ?? value;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Platný IBAN z kandidáta; při přetažení na další slovo zkouší kratší tvar. */
function validIban(candidate: string) {
  const groups = candidate.trim().split(/\s+/);
  for (let end = groups.length; end >= 3; end--) {
    const value = groups.slice(0, end).join("");
    if (canonicalAccount(value)) return value;
  }
  const compact = candidate.replace(/\s/g, "");
  return canonicalAccount(compact) ? compact : null;
}

/**
 * Bankovní účty v textu faktury. Český tvar `předčíslí-číslo/kód` jen v řádku
 * se slovem „účet“, „bankovní spojení“ apod. (nebo hned pod ním) -- jinak by
 * se za účet mohlo vzít datum nebo číslo dokladu. IBAN se pozná kdekoli.
 */
export function accountsInText(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const found: string[] = [];
  lines.forEach((line, index) => {
    const context = `${lines[index - 1] ?? ""} ${line}`;
    if (ACCOUNT_CONTEXT.test(context)) {
      for (const match of line.matchAll(CZECH_ACCOUNT)) {
        const [, prefix, number, bank] = match;
        const account = `${prefix ? `${prefix}-` : ""}${number}/${bank}`;
        if (canonicalAccount(account)) found.push(account);
      }
    }
    for (const match of line.matchAll(IBAN_START)) {
      const iban = validIban(match[0]);
      if (iban) found.push(iban);
    }
  });
  return unique(found);
}

export type DocumentAccounts = { qr: string[]; isdoc: string[]; text: string[] };
export type DocumentAccountCheck = { paymentAccount: string | null; warnings: string[] };

function ownDistinct(candidates: string[], accounts: OrganizationAccount[]) {
  const own = new Map<string, OrganizationAccount>();
  for (const candidate of candidates) {
    const match = matchOrganizationAccount(candidate, accounts);
    if (match) own.set(canonicalAccount(match.account) ?? match.account, match);
  }
  return [...own.values()];
}

/**
 * Rozhodne o účtu faktury podle účtů nalezených na dokladu. Přesné zdroje
 * (QR platba, ISDOC) mají přednost před textem.
 */
export function checkDocumentPaymentAccount(
  found: DocumentAccounts,
  accounts: OrganizationAccount[],
  invoiceCurrency: string,
): DocumentAccountCheck {
  const fallback = `Platba půjde na výchozí účet pro ${invoiceCurrency}.`;
  const exact = unique([...found.qr, ...found.isdoc]);
  const all = unique([...exact, ...found.text]);
  if (!all.length) return { paymentAccount: null, warnings: [] };

  const exactOwn = ownDistinct(exact, accounts);
  const own = exactOwn.length ? exactOwn : ownDistinct(found.text, accounts);

  if (own.length > 1) {
    return {
      paymentAccount: null,
      warnings: [`Na faktuře je více vašich účtů (${own.map((item) => item.account).join(", ")}). ${fallback} Zkontrolujte účet na dokladu.`],
    };
  }
  if (own.length === 1) {
    const [match] = own;
    if (match.currency !== invoiceCurrency) {
      return {
        paymentAccount: null,
        warnings: [`Účet na faktuře ${match.account} je u vás vedený v ${match.currency}, ale faktura je v ${invoiceCurrency}. ${fallback}`],
      };
    }
    return { paymentAccount: match.account, warnings: [] };
  }
  return {
    paymentAccount: null,
    warnings: [`Účet na faktuře ${all[0]} není mezi vašimi bankovními účty (Nastavení → Bankovní účty). ${fallback}`],
  };
}
