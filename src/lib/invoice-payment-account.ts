import { canonicalAccount, matchOrganizationAccount, type OrganizationAccount } from "./bank-accounts";
import type { OcrDocumentLayout } from "./invoice-ocr";
import { conceptAlternation } from "./invoice-ocr-vocabulary";

// Účet DODAVATELE na faktuře čtené z PDF porovnaný se VŠEMI účty firmy (hlavní CZK/EUR
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

type AccountRole = "issuer" | "counterparty" | "unknown";
type AccountOccurrence = { account: string; role: AccountRole };
const ISSUER = new RegExp(`\\b(?:${conceptAlternation("issuer")}|dodavatele|vystavitele|prodavajiciho)\\b`, "i");
const CUSTOMER = new RegExp(`\\b(?:${conceptAlternation("counterparty")}|odberatele|zakaznika|kupujiciho)\\b`, "i");
const PAYMENT_SECTION = /^(?:platebni udaje|udaje pro platbu|platebni instrukce|payment details|payment instructions)\b/i;
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function accountOccurrences(lines: string[], initialRole: AccountRole = "unknown"): AccountOccurrence[] {
  const found: AccountOccurrence[] = [];
  let role = initialRole;
  let previous = "";
  for (const line of lines) {
    const plain = normalized(line);
    // Process headings in reading order, including explicitly labelled accounts
    // on one line ("Účet dodavatele ... Účet odběratele ...").
    const headings = [...plain.matchAll(new RegExp(`(${ISSUER.source})|(${CUSTOMER.source})`, "gi"))];
    if (PAYMENT_SECTION.test(plain.trim())) role = "unknown";
    const roleAt = (index: number): AccountRole => {
      const heading = headings.findLast(match => match.index! <= index);
      return heading ? heading[1] ? "issuer" : "counterparty" : role;
    };
    const context = headings.length ? line : `${previous} ${line}`;
    if (ACCOUNT_CONTEXT.test(context)) {
      for (const match of line.matchAll(CZECH_ACCOUNT)) {
        const [, prefix, number, bank] = match;
        const account = `${prefix ? `${prefix}-` : ""}${number}/${bank}`;
        if (canonicalAccount(account)) found.push({ account, role: roleAt(match.index!) });
      }
    }
    for (const match of line.matchAll(IBAN_START)) {
      const account = validIban(match[0]);
      if (account) found.push({ account, role: roleAt(match.index!) });
    }
    if (headings.length) role = headings[headings.length - 1][1] ? "issuer" : "counterparty";
    previous = line;
  }
  return found;
}

/** Payment accounts of the supplier, never accounts of the invoice recipient.
 * Geometry disambiguates two-column PDFs whose plain text interleaves parties.
 * Unlabelled payment details remain supported; checksums are always required.
 */
export function accountsInText(text: string, layout?: OcrDocumentLayout): string[] {
  const occurrences = accountOccurrences(text.split(/\r?\n/));
  const positioned: AccountOccurrence[] = [];
  for (const page of layout?.pages ?? []) {
    const blocks = page.lines.flatMap(line => line.blocks);
    const issuer = blocks.find(block => ISSUER.test(normalized(block.text)));
    const customer = blocks.find(block => CUSTOMER.test(normalized(block.text)));
    if (!issuer || !customer || Math.abs(issuer.x - customer.x) <= 0.15) continue;
    const middle = (issuer.x + customer.x) / 2;
    // A separate full-width payment section is not part of either party box.
    const paymentStart = page.lines.findIndex(line => PAYMENT_SECTION.test(normalized(line.text).trim()));
    const partyLines = paymentStart < 0 ? page.lines : page.lines.slice(0, paymentStart);
    for (const party of [issuer, customer]) {
      const column = partyLines.map(line => line.blocks
        .filter(block => (block.x < middle) === (party.x < middle))
        .sort((a, b) => a.x - b.x)
        .map(block => block.text).join(" ")).filter(Boolean);
      positioned.push(...accountOccurrences(column, party === issuer ? "issuer" : "counterparty"));
    }
  }
  const positionedRoles = new Map<string, Set<AccountRole>>();
  for (const item of positioned) {
    const key = canonicalAccount(item.account)!;
    const roles = positionedRoles.get(key) ?? new Set<AccountRole>();
    roles.add(item.role);
    positionedRoles.set(key, roles);
  }
  return unique([...occurrences, ...positioned].filter(item => {
    const roles = positionedRoles.get(canonicalAccount(item.account)!);
    return roles ? roles.has("issuer") || roles.has("unknown") : item.role !== "counterparty";
  }).map(item => item.account));
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
