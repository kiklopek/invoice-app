import { createHash } from "node:crypto";
import {
  MAX_GPC_IMPORT_ROWS,
  normalizeVariableSymbol,
  type PaymentImportRow,
  validatePaymentRows,
} from "./payment-import";

export type GpcEntryDisposition =
  | "accepted"
  | "ignored"
  | "error"
  | "duplicate";

export interface GpcPreviewEntry {
  line: number;
  recordType: string;
  disposition: GpcEntryDisposition;
  reason?: string;
  fingerprint: string;
  payment?: PaymentImportRow;
  transactionCode?: string;
}

export interface GpcParseResult {
  fileHash: string;
  accountNumber: string | null;
  entries: GpcPreviewEntry[];
  payments: PaymentImportRow[];
  totals: { accepted: number; ignored: number; errors: number };
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseGpcDate(value: string) {
  if (!/^\d{6}$/.test(value) || value === "000000") return "";
  const day = value.slice(0, 2);
  const month = value.slice(2, 4);
  const shortYear = Number(value.slice(4, 6));
  const year = shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(Date.UTC(year, Number(month) - 1, Number(day)));
  return date.toISOString().slice(0, 10) === iso ? iso : "";
}

function normalizeAccount(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits || "0";
}

/**
 * KB's "klientský formát KM" -- the .gpc that KB+ exports -- writes account
 * numbers in what its specification calls the INTERNAL format: the sixteen
 * digits of the ordinary (edition) format, permuted. Read as-is they are not a
 * bank account at all, merely a scramble of one. This table is the inverse:
 * edition digit N(i+1) is at internal position KM_EDITION_FROM_INTERNAL[i].
 *
 *   edition   N1  N2  N3  N4  N5  N6  N7  N8  N9 N10 N11 N12 N13 N14 N15 N16
 *   internal  N16 N14 N15 N12 N7  N8  N9  N10 N11 N13 N1  N2  N3  N4  N5  N6
 *
 * Confirmed against this account's own statement: the header's
 * "7252678640000000" decodes to 6786420257, the number printed on the
 * invoices, and every counterparty decodes to an account whose bank code then
 * agrees with the one on that customer's invoice.
 */
const KM_EDITION_FROM_INTERNAL = [10, 11, 12, 13, 14, 15, 4, 5, 6, 7, 8, 3, 9, 1, 2, 0];

const PREFIX_WEIGHTS = [10, 5, 8, 4, 2, 1];
const ACCOUNT_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];

/** Czech account numbers carry a weighted modulo-11 check digit. */
function passesModulo11(digits: string, weights: number[]) {
  if (digits.length !== weights.length || !/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1)
    sum += Number(digits[index]) * weights[index];
  return sum % 11 === 0;
}

function isPlausibleCzechAccount(edition: string) {
  return (
    /^\d{16}$/.test(edition) &&
    Number(edition.slice(6)) > 0 &&
    passesModulo11(edition.slice(0, 6), PREFIX_WEIGHTS) &&
    passesModulo11(edition.slice(6), ACCOUNT_WEIGHTS)
  );
}

/** "6786420257/0100", or "107-6625740217/0100" when a prefix is present. */
function formatAccount(edition: string, bankCode: string) {
  const prefix = edition.slice(0, 6).replace(/^0+/, "");
  const account = edition.slice(6).replace(/^0+/, "");
  if (!account) return "0";
  const local = prefix ? `${prefix}-${account}` : account;
  return /^\d{4}$/.test(bankCode) && bankCode !== "0000"
    ? `${local}/${bankCode}`
    : local;
}

/**
 * The permutation is applied only to statements that identify themselves as
 * KB's KM format. Other banks' GPC exports carry the edition format directly,
 * and permuting those would scramble what is already correct. The modulo-11
 * check is the second opinion: a decode that fails it while the raw digits pass
 * means the guess about the format was wrong, so the raw digits win.
 */
function readAccount(raw: string, kmFormat: boolean, bankCode = "") {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 16) return normalizeAccount(raw);
  if (Number(digits) === 0) return "0";
  if (!kmFormat) return formatAccount(digits, bankCode);
  const edition = KM_EDITION_FROM_INTERNAL.map((position) => digits[position]).join("");
  if (isPlausibleCzechAccount(edition)) return formatAccount(edition, bankCode);
  if (isPlausibleCzechAccount(digits)) return formatAccount(digits, bankCode);
  return formatAccount(edition, bankCode);
}

function decodeGpc(bytes: Uint8Array) {
  try {
    return new TextDecoder("windows-1250", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
  } catch {
    throw new Error("Soubor GPC nelze přečíst jako Windows-1250.");
  }
}

export function parseGpc(bytes: Uint8Array): GpcParseResult {
  if (bytes.byteLength === 0) throw new Error("Soubor GPC je prázdný.");
  const text = decodeGpc(bytes);
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const headerCount = lines.filter((line) => line.startsWith("074")).length;
  if (headerCount === 0) {
    throw new Error("Soubor neobsahuje hlavičku GPC 074.");
  }
  if (headerCount > 1) {
    throw new Error("Soubor obsahuje více hlaviček GPC 074, očekávána je jedna.");
  }
  const transactionCount = lines.filter((line) =>
    line.startsWith("075"),
  ).length;
  if (transactionCount > MAX_GPC_IMPORT_ROWS) {
    throw new Error(
      `Jeden GPC import může obsahovat nejvýše ${MAX_GPC_IMPORT_ROWS} transakcí.`,
    );
  }

  const header = lines.find((line) => line.startsWith("074"));
  // KB+ stamps its channel ("MB") at 123-124 and the IBAN's country/check/bank
  // prefix at 115-122. Either one identifies the KM dialect, whose account
  // numbers are permuted; anything else is read as a plain edition-format GPC.
  const ownBankCode =
    header && /^CZ\d{6}$/.test(header.slice(114, 122)) ? header.slice(118, 122) : "";
  const kmFormat = Boolean(
    header && (header.slice(122, 124) === "MB" || ownBankCode),
  );
  const accountNumber =
    header && header.length >= 19
      ? readAccount(header.slice(3, 19), kmFormat, ownBankCode)
      : null;
  const entries: GpcPreviewEntry[] = [];
  const candidatePayments: PaymentImportRow[] = [];

  lines.forEach((line, index) => {
    if (!line.startsWith("075")) return;
    const fingerprint = sha256(line);
    const base = { line: index + 1, recordType: "075", fingerprint };
    if (line.length !== 128) {
      entries.push({
        ...base,
        disposition: "error",
        reason: `Řádek má ${line.length} znaků, očekáváno je 128.`,
      });
      return;
    }
    const transactionCode = line.slice(60, 61);
    if (transactionCode !== "2") {
      const reason =
        transactionCode === "1"
          ? "Odchozí platba (debet)."
          : transactionCode === "4" || transactionCode === "5"
            ? "Storno platby."
            : "Neznámý typ transakce.";
      entries.push({
        ...base,
        disposition: "ignored",
        reason,
        transactionCode,
      });
      return;
    }
    const amountHellers = Number(line.slice(48, 60));
    const bookedOn = parseGpcDate(line.slice(122, 128));
    // Positions 74-77 hold the counterparty's bank code, which KB carries
    // inside the constant-symbol field (the actual KS is its last four digits).
    const counterpartyAccount = readAccount(
      line.slice(19, 35),
      kmFormat,
      line.slice(73, 77),
    );
    const payment: PaymentImportRow = {
      external_id: `gpc-${fingerprint}`,
      booked_on: bookedOn,
      amount: amountHellers / 100,
      // GPC ("tuzemský platební styk") is a Czech DOMESTIC clearing export
      // format -- it has no currency field at all, every transaction in it
      // is CZK by definition. Bytes 118-121 (previously misread here as an
      // ISO 4217 numeric currency code) are something else entirely -- most
      // likely the counterparty's bank code, going by real exported
      // statements, where that byte range holds "0100"/"0170"-shaped values
      // matching real Czech bank codes (e.g. Komerční banka = 0100), never
      // "0203" (CZK's actual numeric code). Treating it as currency silently
      // rejected every single real transaction as "unsupported currency".
      currency: "CZK",
      variable_symbol: normalizeVariableSymbol(line.slice(61, 71)),
      counterparty_name: line.slice(97, 117).trim() || undefined,
      counterparty_account: counterpartyAccount,
      note: `GPC doklad ${line.slice(35, 48).trim()}`,
    };
    if (!validatePaymentRows([payment], 1)) {
      entries.push({
        ...base,
        disposition: "error",
        reason:
          "Transakce obsahuje neplatné datum, částku nebo identifikátory.",
        transactionCode,
      });
      return;
    }
    candidatePayments.push(payment);
    entries.push({
      ...base,
      disposition: "accepted",
      transactionCode,
      payment,
    });
  });

  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.disposition !== "accepted") continue;
    if (seen.has(entry.fingerprint)) {
      entry.disposition = "duplicate";
      entry.reason = "Duplicitní transakce v souboru.";
      entry.payment = undefined;
    } else seen.add(entry.fingerprint);
  }
  const payments = entries.flatMap((entry) =>
    entry.disposition === "accepted" && entry.payment ? [entry.payment] : [],
  );
  if (entries.length === 0)
    throw new Error("Soubor neobsahuje žádné záznamy GPC 075.");
  return {
    fileHash: sha256(bytes),
    accountNumber,
    entries,
    payments,
    totals: {
      accepted: payments.length,
      ignored: entries.filter(
        (entry) =>
          entry.disposition === "ignored" || entry.disposition === "duplicate",
      ).length,
      errors: entries.filter((entry) => entry.disposition === "error").length,
    },
  };
}
