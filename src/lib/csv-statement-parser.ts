import { createHash } from "node:crypto";
import { parsePaymentCsv } from "./payment-import";
import type { GpcParseResult, GpcPreviewEntry } from "./gpc-parser";

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function decodeCsv(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    throw new Error("Soubor CSV nelze přečíst.");
  }
}

// CSV statements carry no bank account number, so account-mismatch checking
// (which only applies to structured formats like GPC) is skipped for this format.
export function parseCsvStatement(bytes: Uint8Array): GpcParseResult {
  if (bytes.byteLength === 0) throw new Error("Soubor CSV je prázdný.");
  const payments = parsePaymentCsv(decodeCsv(bytes));

  const entries: GpcPreviewEntry[] = payments.map((payment, index) => ({
    line: index + 2,
    recordType: "csv",
    disposition: "accepted",
    fingerprint: sha256(`csv:${payment.external_id}`),
    payment,
  }));

  return {
    fileHash: sha256(bytes),
    accountNumber: null,
    entries,
    payments,
    totals: {
      accepted: payments.length,
      ignored: 0,
      errors: 0,
    },
  };
}
