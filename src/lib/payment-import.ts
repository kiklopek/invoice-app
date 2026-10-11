import { matchOrganizationAccount, organizationAccounts, paymentAccountFor } from "./bank-accounts";

export const MAX_PAYMENT_IMPORT_ROWS = 500;
export const MAX_GPC_IMPORT_ROWS = 10_000;

type PrimaryAccounts = { bank_account_czk?: string | null; bank_account_eur?: string | null };
type ExtraAccounts = { account: string; currency: string }[];

// A statement carries one account number for the whole file but currency per
// transaction. This picks which of the org's accounts is the expected one for
// display -- null when there's no single currency, or no account for it.
export function resolveConfiguredAccountForCurrencies(
  paymentCurrencies: string[],
  company: PrimaryAccounts,
  extraAccounts: ExtraAccounts = [],
): string | null {
  const distinctCurrencies = new Set(paymentCurrencies);
  const statementCurrency = distinctCurrencies.size === 1 ? [...distinctCurrencies][0] : null;
  return statementCurrency ? paymentAccountFor(statementCurrency, company, extraAccounts) : null;
}

/**
 * Is the statement from an account that is NOT the company's? Every
 * registered account counts (hlavní CZK/EUR i další účty), compared with the
 * bank code -- the same number at another bank is somebody else's account.
 * No account on the statement (CSV) or none configured: nothing to compare.
 */
export function detectStatementAccountMismatch(params: {
  statementAccountNumber: string | null;
  paymentCurrencies: string[];
  company: PrimaryAccounts;
  extraAccounts?: ExtraAccounts;
}): boolean {
  if (!params.statementAccountNumber?.trim()) return false;
  const accounts = organizationAccounts(params.company, params.extraAccounts ?? []);
  if (accounts.length === 0) return false;
  return matchOrganizationAccount(params.statementAccountNumber, accounts) === null;
}

/** Měna výpisu podle účtu firmy, ke kterému patří (null = neznámý účet). */
export function statementCurrencyFor(
  statementAccountNumber: string | null | undefined,
  company: PrimaryAccounts,
  extraAccounts: ExtraAccounts = [],
) {
  return matchOrganizationAccount(statementAccountNumber, organizationAccounts(company, extraAccounts))?.currency ?? null;
}

export interface PaymentImportRow {
  external_id: string;
  booked_on: string;
  amount: number;
  currency: string;
  variable_symbol: string;
  counterparty_name?: string;
  counterparty_account?: string;
  // undefined => trusted (CSV/manual entry has no checksum concept to fail).
  // Only GPC's readAccount() sets this explicitly, to false when a decoded
  // account number failed the Czech mod-11 check on both candidate readings.
  counterparty_account_verified?: boolean;
  note?: string;
  /** Present only for the separately gated CAMT parser. */
  bank_reference?: string;
  statement_account?: string;
}

function splitCsvRow(row: string, delimiter: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '"') {
      if (quoted && row[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("CSV obsahuje neuzavřené uvozovky.");
  values.push(value.trim());
  return values;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("cs")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ");
}

function parseDate(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const czech = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (!czech) return "";
  return `${czech[3]}-${czech[2].padStart(2, "0")}-${czech[1].padStart(2, "0")}`;
}

export function isRealPaymentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return (
    new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) ===
    value
  );
}

/**
 * Částka z CSV banky. Mezery (i nezlomitelné) jsou oddělovač tisíců. Když
 * jsou v čísle čárka i tečka, desetinný je ten poslední. Jediný oddělovač
 * následovaný přesně třemi číslicemi („1.500“, „1,500“) je nejednoznačný --
 * tisíce, nebo desetiny? -- a vrací NaN: dřív z „1.500“ tiše vzniklo 1,5.
 */
function parseAmount(value: string) {
  const cleaned = value.replace(/[\s\u00a0\u202f]/g, "").replace(/[^\d,.+-]/g, "");
  if (!/^[+-]?[\d.,]*\d[\d.,]*$/.test(cleaned)) return Number.NaN;
  const sign = cleaned.startsWith("-") ? -1 : 1;
  const digits = cleaned.replace(/^[+-]/, "");
  const comma = digits.lastIndexOf(",");
  const dot = digits.lastIndexOf(".");
  let normalized: string;
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    const cut = digits.lastIndexOf(decimal);
    const whole = digits.slice(0, cut);
    const fraction = digits.slice(cut + 1);
    if (fraction.includes(thousands) || !new RegExp(`^\\d{1,3}(\\${thousands}\\d{3})*$`).test(whole)) return Number.NaN;
    normalized = `${whole.split(thousands).join("")}.${fraction}`;
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? "," : ".";
    const parts = digits.split(separator);
    if (parts.length > 2) {
      // 1.500.000 -- víc stejných oddělovačů jsou tisíce.
      if (!parts.slice(1).every((part) => part.length === 3)) return Number.NaN;
      normalized = parts.join("");
    } else if (parts[1].length === 3) {
      return Number.NaN;
    } else {
      normalized = `${parts[0]}.${parts[1]}`;
    }
  } else {
    normalized = digits;
  }
  return sign * Number(normalized);
}

export function normalizeVariableSymbol(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\s/g, "");
  if (!digits) return "";
  return digits.replace(/^0+(?=\d)/, "");
}

export function validatePaymentRows(
  value: unknown,
  maximumRows = MAX_PAYMENT_IMPORT_ROWS,
): PaymentImportRow[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumRows)
    return null;
  const parsed: PaymentImportRow[] = [];
  const identifiers = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const externalId =
      typeof row.external_id === "string" ? row.external_id.trim() : "";
    const bookedOn =
      typeof row.booked_on === "string" ? row.booked_on.trim() : "";
    const amount = Number(row.amount);
    const currency =
      typeof row.currency === "string" ? row.currency.trim().toUpperCase() : "";
    const variableSymbol =
      typeof row.variable_symbol === "string"
        ? normalizeVariableSymbol(row.variable_symbol)
        : "";
    const counterpartyName =
      typeof row.counterparty_name === "string"
        ? row.counterparty_name.trim()
        : "";
    const counterpartyAccount =
      typeof row.counterparty_account === "string"
        ? row.counterparty_account.trim()
        : "";
    const note = typeof row.note === "string" ? row.note.trim() : "";

    if (
      !externalId ||
      externalId.length > 120 ||
      identifiers.has(externalId) ||
      !isRealPaymentDate(bookedOn) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 999_999_999_999.99 ||
      !/^[A-Z]{3}$/.test(currency) ||
      variableSymbol.length > 20 ||
      !/^\d*$/.test(variableSymbol) ||
      counterpartyName.length > 200 ||
      counterpartyAccount.length > 100 ||
      note.length > 500
    )
      return null;

    identifiers.add(externalId);
    parsed.push({
      external_id: externalId,
      booked_on: bookedOn,
      amount: Math.round(amount * 100) / 100,
      currency,
      variable_symbol: variableSymbol,
      counterparty_name: counterpartyName || undefined,
      counterparty_account: counterpartyAccount || undefined,
      note: note || undefined,
    });
  }
  return parsed;
}

function csvLayout(text: string) {
  const clean = text.replace(/^\uFEFF/, "").trim();
  const lines = clean.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV neobsahuje žádné platby.");
  if (lines.length - 1 > MAX_PAYMENT_IMPORT_ROWS)
    throw new Error(
      `Jeden import může obsahovat nejvýše ${MAX_PAYMENT_IMPORT_ROWS} plateb.`,
    );

  const delimiter =
    (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const headers = splitCsvRow(lines[0], delimiter).map(normalizeHeader);
  const column = (...names: string[]) =>
    headers.findIndex((header) => names.includes(header));
  const columns = {
    id: column(
      "id transakce",
      "identifikátor transakce",
      "identifikator transakce",
      "transaction id",
      "external id",
    ),
    date: column(
      "datum",
      "datum zaúčtování",
      "datum zauctovani",
      "booked on",
      "date",
    ),
    amount: column("částka", "castka", "amount"),
    currency: column("měna", "mena", "currency"),
    variable: column(
      "variabilní symbol",
      "variabilni symbol",
      "vs",
      "variable symbol",
    ),
    name: column(
      "protistrana",
      "název protistrany",
      "nazev protistrany",
      "counterparty",
      "counterparty name",
    ),
    account: column(
      "účet protistrany",
      "ucet protistrany",
      "counterparty account",
      "iban",
    ),
    note: column("poznámka", "poznamka", "zpráva", "zprava", "note", "message"),
  };
  if (
    [columns.id, columns.date, columns.amount, columns.currency].some(
      (index) => index < 0,
    )
  ) {
    throw new Error(
      "CSV musí obsahovat ID transakce, datum, částku a měnu. Variabilní symbol je doporučený pro automatické spárování.",
    );
  }
  return { lines, delimiter, columns };
}

export function parsePaymentCsv(text: string): PaymentImportRow[] {
  const { lines, delimiter, columns } = csvLayout(text);
  const rows = lines.slice(1).map((line, index) => {
    const values = splitCsvRow(line, delimiter);
    const bookedOn = parseDate(values[columns.date] ?? "");
    const amount = parseAmount(values[columns.amount] ?? "");
    return {
      external_id: values[columns.id] ?? "",
      booked_on: bookedOn,
      amount,
      // Měna se nedoplňuje: prázdná měna u eurového účtu by se zaúčtovala jako CZK.
      currency: (values[columns.currency] ?? "").trim().toUpperCase(),
      variable_symbol:
        columns.variable >= 0
          ? normalizeVariableSymbol(values[columns.variable])
          : "",
      counterparty_name: columns.name >= 0 ? values[columns.name] : undefined,
      counterparty_account:
        columns.account >= 0 ? values[columns.account] : undefined,
      note: columns.note >= 0 ? values[columns.note] : undefined,
      rowNumber: index + 2,
    };
  });
  const validated = validatePaymentRows(rows);
  if (!validated)
    throw new Error(
      "CSV obsahuje neplatný nebo duplicitní řádek. Zkontrolujte ID, datum, kladnou částku, třípísmennou měnu a variabilní symbol.",
    );
  return validated;
}

export type CsvStatementRow = {
  line: number;
  disposition: "accepted" | "ignored" | "error";
  reason?: string;
  payment?: PaymentImportRow;
};

/**
 * CSV výpis z banky řádek po řádku, jako GPC: odchozí platby se přeskočí,
 * vadný řádek je chyba jen toho řádku, ne celého souboru. Měna se nikdy
 * nedoplní (prázdná = chyba řádku), nečíselná reference (RF…) jde do zprávy.
 */
export function parseStatementCsv(text: string): CsvStatementRow[] {
  const { lines, delimiter, columns } = csvLayout(text);
  const seen = new Set<string>();
  return lines.slice(1).map((line, index): CsvStatementRow => {
    const lineNumber = index + 2;
    const values = splitCsvRow(line, delimiter);
    const amount = parseAmount(values[columns.amount] ?? "");
    if (!Number.isFinite(amount))
      return { line: lineNumber, disposition: "error", reason: "Částku nejde jednoznačně přečíst (např. „1.500“ může být 1 500 i 1,5)." };
    if (amount < 0) return { line: lineNumber, disposition: "ignored", reason: "Odchozí platba (debet)." };
    if (amount === 0) return { line: lineNumber, disposition: "ignored", reason: "Nulová částka." };
    const currency = (values[columns.currency] ?? "").trim().toUpperCase();
    if (!currency) return { line: lineNumber, disposition: "error", reason: "Chybí měna platby." };
    const reference = columns.variable >= 0 ? (values[columns.variable] ?? "").replace(/\s/g, "") : "";
    const numericReference = /^\d*$/.test(reference);
    const note = columns.note >= 0 ? values[columns.note] : undefined;
    const row = {
      external_id: values[columns.id] ?? "",
      booked_on: parseDate(values[columns.date] ?? ""),
      amount,
      currency,
      variable_symbol: numericReference ? normalizeVariableSymbol(reference) : "",
      counterparty_name: columns.name >= 0 ? values[columns.name] : undefined,
      counterparty_account: columns.account >= 0 ? values[columns.account] : undefined,
      note: numericReference ? note : [reference, note].filter(Boolean).join(" "),
    };
    const payment = validatePaymentRows([row], 1)?.[0];
    if (!payment || seen.has(payment.external_id))
      return { line: lineNumber, disposition: "error", reason: "Řádek má neplatné nebo duplicitní ID, datum, měnu či symbol." };
    seen.add(payment.external_id);
    return { line: lineNumber, disposition: "accepted", payment };
  });
}
