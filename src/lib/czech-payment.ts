// QR platba na faktuře: v Česku to zákazník očekává a ručně přepsaný
// variabilní symbol je nejčastější důvod, proč platba nedojde spárovat.
//
// Formát QR platby (SPAYD) vyžaduje IBAN, zatímco aplikace drží účty
// v českém tvaru "[předčíslí-]číslo/kód banky". Převod se proto počítá tady.

/** Rozložený český účet. Předčíslí je nepovinné. */
export type CzechAccount = { prefix: string; number: string; bank: string };

export function parseCzechAccount(raw: string | null | undefined): CzechAccount | null {
  if (!raw) return null;
  const match = /^\s*(?:(\d{1,6})\s*-\s*)?(\d{1,10})\s*\/\s*(\d{4})\s*$/.exec(raw);
  if (!match) return null;
  return { prefix: match[1] ?? "", number: match[2], bank: match[3] };
}

/**
 * Česká vážená mod-11 kontrola. Předčíslí i základ mají vlastní váhy a
 * musí projít každé zvlášť -- stejné pravidlo jako u bankovních výpisů
 * (viz docs/bank-formats/kb-gpc-km.md).
 */
const PREFIX_WEIGHTS = [10, 5, 8, 4, 2, 1];
const NUMBER_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];

function passesMod11(digits: string, weights: number[]) {
  const padded = digits.padStart(weights.length, "0");
  let sum = 0;
  for (let index = 0; index < weights.length; index += 1) {
    sum += Number(padded[index]) * weights[index];
  }
  return sum % 11 === 0;
}

export function isPlausibleCzechAccount(account: CzechAccount) {
  if (account.prefix && !passesMod11(account.prefix, PREFIX_WEIGHTS)) return false;
  return passesMod11(account.number, NUMBER_WEIGHTS);
}

/**
 * Převede český účet na IBAN. Vrací null, když vstup není platný účet --
 * nikdy nehádá, protože špatný IBAN v QR kódu pošle peníze jinam.
 */
export function czechAccountToIban(raw: string | null | undefined): string | null {
  const account = parseCzechAccount(raw);
  if (!account) return null;
  if (!isPlausibleCzechAccount(account)) return null;

  // BBAN = kód banky (4) + předčíslí (6) + číslo účtu (10)
  const bban = `${account.bank}${account.prefix.padStart(6, "0")}${account.number.padStart(10, "0")}`;

  // Kontrolní číslice podle ISO 13616: BBAN + "CZ00" přeložené na číslice,
  // mod 97, výsledek odečtený od 98. "C" = 12, "Z" = 35.
  const rearranged = `${bban}123500`;
  let remainder = 0;
  for (const char of rearranged) {
    remainder = (remainder * 10 + Number(char)) % 97;
  }
  const check = String(98 - remainder).padStart(2, "0");
  return `CZ${check}${bban}`;
}

/** Odstraní diakritiku -- SPAYD je definovaný nad omezenou znakovou sadou. */
function asciiFold(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export type SpaydPayment = {
  account: string | null | undefined;
  amount: number;
  currency: string;
  variableSymbol?: string | null;
  message?: string | null;
  dueDate?: string | null;
};

/**
 * Sestaví řetězec QR platby. Vrací null, když chybí něco, bez čeho by
 * platba nebyla proveditelná -- prázdný nebo neúplný QR kód je horší než
 * žádný, protože vypadá funkčně.
 */
export function buildSpayd(payment: SpaydPayment): string | null {
  const iban = czechAccountToIban(payment.account);
  if (!iban) return null;
  if (!Number.isFinite(payment.amount) || payment.amount <= 0) return null;
  if (!/^[A-Z]{3}$/.test(payment.currency)) return null;

  const fields = [
    `ACC:${iban}`,
    `AM:${payment.amount.toFixed(2)}`,
    `CC:${payment.currency}`,
  ];
  // Pole SPAYD jsou oddělená hvězdičkou, takže hvězdička ani dvojtečka
  // se do hodnot dostat nesmí.
  // Nahrazene oddelovace by jinak nechaly zdvojene mezery.
  const clean = (value: string, max: number) =>
    asciiFold(value).replace(/[*:]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

  if (payment.variableSymbol) {
    const vs = payment.variableSymbol.replace(/\D/g, "").slice(0, 10);
    if (vs) fields.push(`X-VS:${vs}`);
  }
  if (payment.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(payment.dueDate)) {
    fields.push(`DT:${payment.dueDate.replace(/-/g, "")}`);
  }
  if (payment.message) {
    const message = clean(payment.message, 60);
    if (message) fields.push(`MSG:${message}`);
  }

  return `SPD*1.0*${fields.join("*")}`;
}
