import { createHash } from "node:crypto";
import {
  MAX_GPC_IMPORT_ROWS,
  normalizeVariableSymbol,
  type PaymentImportRow,
  validatePaymentRows,
} from "./payment-import";

export type GpcEntryDisposition = "accepted" | "ignored" | "error";

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
  const accountNumber =
    header && header.length >= 19
      ? normalizeAccount(header.slice(3, 19))
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
    const currencyCode = line.slice(118, 122);
    if (currencyCode !== "0203") {
      entries.push({
        ...base,
        disposition: "ignored",
        reason: "Podporovány jsou pouze tuzemské CZK platby.",
        transactionCode,
      });
      return;
    }
    const amountHellers = Number(line.slice(48, 60));
    const bookedOn = parseGpcDate(line.slice(122, 128));
    const counterpartyAccount = normalizeAccount(line.slice(19, 35));
    const payment: PaymentImportRow = {
      external_id: `gpc-${fingerprint}`,
      booked_on: bookedOn,
      amount: amountHellers / 100,
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
      entry.disposition = "ignored";
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
      ignored: entries.filter((entry) => entry.disposition === "ignored")
        .length,
      errors: entries.filter((entry) => entry.disposition === "error").length,
    },
  };
}
