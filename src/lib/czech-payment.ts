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

/**
 * QR platba k faktuře. Jediný zdroj pro PDF i tělo upomínky, aby dlužník
 * nikdy neviděl dvě různé částky. Zní na zbývající částku; u plně uhrazené
 * faktury na celou (PDF faktury se tiskne i zpětně).
 */
export function invoiceSpayd(
  invoice: {
    invoice_number: string;
    counterparty_name?: string | null;
    variable_symbol?: string | null;
    amount: number | string;
    paid_amount: number | string;
    currency: string;
    due_date?: string | null;
  },
  company: { bank_account_czk?: string | null; bank_account_eur?: string | null },
): string | null {
  const remaining = Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount));
  // Zpráva pro příjemce: podle čísla faktury a jména odběratele účetní na
  // výpisu hned pozná, kdo platil. Číslo je první, takže ho limit 60 znaků
  // v buildSpayd nikdy neuřízne -- zkrátí se nanejvýš jméno.
  const payer = invoice.counterparty_name?.trim();
  return buildSpayd({
    account: invoice.currency === "EUR" ? company.bank_account_eur : company.bank_account_czk,
    amount: remaining > 0 ? remaining : Number(invoice.amount),
    currency: invoice.currency,
    variableSymbol: invoice.variable_symbol,
    dueDate: invoice.due_date,
    message: payer ? `Faktura ${invoice.invoice_number} - ${payer}` : `Faktura ${invoice.invoice_number}`,
  });
}

/** QR platba přečtená z cizí faktury. Chybějící nebo poškozené pole je null. */
export type ParsedSpayd = {
  iban: string;
  bic: string | null;
  /** Český tvar účtu, když jde o platný český IBAN; jinak null. */
  account: string | null;
  amount: number | null;
  currency: string | null;
  variableSymbol: string | null;
  constantSymbol: string | null;
  specificSymbol: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  message: string | null;
  recipientName: string | null;
};

/** ISO 13616 mod-97 kontrola IBANu (libovolná země). */
export function isValidIban(raw: string) {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const char of rearranged) {
    const value = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Převede český IBAN zpět na "[předčíslí-]číslo/kód banky"; jen platný účet. */
export function czechIbanToAccount(iban: string): string | null {
  const compact = iban.replace(/\s/g, "").toUpperCase();
  if (!/^CZ\d{22}$/.test(compact) || !isValidIban(compact)) return null;
  const bank = compact.slice(4, 8);
  const prefix = compact.slice(8, 14).replace(/^0+/, "");
  const number = compact.slice(14).replace(/^0+/, "");
  if (!number) return null;
  const account = { prefix, number, bank };
  if (!isPlausibleCzechAccount(account)) return null;
  return `${prefix ? `${prefix}-` : ""}${number}/${bank}`;
}

function decodeSpaydValue(value: string) {
  // Hodnoty SPAYD smí obsahovat procentové kódování (hlavně %2A = "*").
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Přečte řetězec QR platby (SPAYD). Vrací null, když nejde o QR platbu nebo
 * když účet neprojde kontrolou IBAN -- špatný účet je horší než žádný. Pole,
 * která nemají předepsaný tvar (částka, VS, datum, měna), se nevyplní, místo
 * aby se odhadovala.
 */
export function parseSpayd(raw: string | null | undefined): ParsedSpayd | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!/^SPD\*\d+\.\d+\*/i.test(text)) return null;
  const fields = new Map<string, string>();
  for (const part of text.split("*").slice(2)) {
    const separator = part.indexOf(":");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).toUpperCase();
    if (!fields.has(key)) fields.set(key, decodeSpaydValue(part.slice(separator + 1)));
  }
  const accountField = fields.get("ACC");
  if (!accountField) return null;
  const [ibanPart, bicPart] = accountField.split("+");
  const iban = ibanPart.replace(/\s/g, "").toUpperCase();
  if (!isValidIban(iban)) return null;

  const amountText = fields.get("AM");
  const amount = amountText && /^\d{1,10}(?:\.\d{1,2})?$/.test(amountText) ? Number(amountText) : null;
  const currencyText = fields.get("CC")?.toUpperCase();
  const digitsOnly = (key: string, max: number) => {
    const value = fields.get(key)?.trim();
    return value && new RegExp(`^\\d{1,${max}}$`).test(value) ? value : null;
  };
  const dateText = fields.get("DT");
  let dueDate: string | null = null;
  if (dateText && /^\d{8}$/.test(dateText)) {
    const iso = `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso) dueDate = iso;
  }
  const freeText = (key: string) => fields.get(key)?.trim().slice(0, 140) || null;

  return {
    iban,
    bic: bicPart && /^[A-Z0-9]{8}(?:[A-Z0-9]{3})?$/i.test(bicPart) ? bicPart.toUpperCase() : null,
    account: czechIbanToAccount(iban),
    amount: amount !== null && amount > 0 ? amount : null,
    currency: currencyText && /^[A-Z]{3}$/.test(currencyText) ? currencyText : null,
    variableSymbol: digitsOnly("X-VS", 10),
    constantSymbol: digitsOnly("X-KS", 10),
    specificSymbol: digitsOnly("X-SS", 10),
    dueDate,
    message: freeText("MSG"),
    recipientName: freeText("RN"),
  };
}
