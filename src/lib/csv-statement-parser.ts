import { createHash } from "node:crypto";
import { parseStatementCsv } from "./payment-import";
import type { GpcParseResult, GpcPreviewEntry } from "./gpc-parser";

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function decodeCsv(bytes: Uint8Array) {
  let utf8: string;
  try {
    utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    throw new Error("Soubor CSV nelze přečíst.");
  }
  // A replacement character means the bytes weren't valid UTF-8 in the first
  // place -- rather than silently keep that mojibake, fall back to
  // Windows-1250 (CP1250), the encoding Czech banks' CSV exports commonly
  // use instead of UTF-8 (same encoding already handled for GPC files).
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  try {
    return new TextDecoder("windows-1250", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return utf8.replace(/^﻿/, "");
  }
}

// CSV statements carry no bank account number, so account-mismatch checking
// (which only applies to structured formats like GPC) is skipped for this format.
export function parseCsvStatement(bytes: Uint8Array): GpcParseResult {
  if (bytes.byteLength === 0) throw new Error("Soubor CSV je prázdný.");
  const rows = parseStatementCsv(decodeCsv(bytes));

  const entries: GpcPreviewEntry[] = rows.map((row) => ({
    line: row.line,
    recordType: "csv",
    disposition: row.disposition,
    reason: row.reason,
    fingerprint: row.payment ? sha256(`csv:${row.payment.external_id}`) : sha256(`csv-line:${row.line}`),
    payment: row.payment,
  }));
  const payments = rows.flatMap((row) => (row.payment ? [row.payment] : []));

  return {
    fileHash: sha256(bytes),
    accountNumber: null,
    entries,
    payments,
    totals: {
      accepted: payments.length,
      ignored: entries.filter((entry) => entry.disposition === "ignored").length,
      errors: entries.filter((entry) => entry.disposition === "error").length,
    },
  };
}
