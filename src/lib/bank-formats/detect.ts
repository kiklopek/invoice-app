import { parseGpc, readHeaderAccount, type GpcDialect, type GpcParseResult } from "@/lib/gpc-parser";
import { parseCzechAccount } from "@/lib/czech-payment";
import type { OrganizationAccount } from "@/lib/bank-accounts";
import { gpcProfileFor } from "./registry";

export type StatementFormat = "gpc" | "csv" | "camt053";

/**
 * Formát výpisu podle obsahu, ne podle přípony (banky exportují GPC i jako
 * .txt a CAMT jako .dat). Null = nic, co umíme přečíst.
 */
export function detectStatementFormat(bytes: Uint8Array, fileName: string): StatementFormat | null {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096)).replace(/^﻿|^ï»¿/, "").trimStart();
  if (/^074\d{16}/.test(head)) return "gpc";
  if (/^<\?xml|^<Document/i.test(head) && /urn:iso:std:iso:20022:tech:xsd:camt\.053/i.test(head)) return "camt053";
  const firstLine = head.split(/\r?\n/, 1)[0] ?? "";
  if (/[;,\t]/.test(firstLine) && !/^</.test(firstLine)) return "csv";
  return fileName.toLowerCase().endsWith(".csv") ? "csv" : null;
}

export type ResolvedGpc = {
  parsed: GpcParseResult;
  bankCode: string | null;
  dialect: GpcDialect;
  verified: boolean;
};

/** Účty firmy rozložené na „předčíslí-číslo“ a kód banky. */
function accountsByLocalNumber(accounts: OrganizationAccount[]) {
  const map = new Map<string, string>();
  for (const item of accounts) {
    const parsed = parseCzechAccount(item.account);
    if (!parsed) continue;
    const local = `${parsed.prefix.replace(/^0+/, "") ? `${parsed.prefix.replace(/^0+/, "")}-` : ""}${parsed.number.replace(/^0+/, "")}`;
    map.set(local, parsed.bank);
  }
  return map;
}

/**
 * Přečte GPC výpis „klíčem“ správné banky:
 * 1. soubor se sám označil jako KB (značky KM) → KB;
 * 2. jinak podle toho, ke kterému účtu firmy hlavička patří -- číslo se
 *    zkusí přečíst každým dialektem z registru a s kódem banky toho účtu;
 * 3. jinak banka neznámá: prostý tvar a žádné číslo účtu není ověřené.
 * Neověřená banka (bez specifikace a vzorku v registru) má čísla protiúčtů
 * vždy neověřená, takže párování jde jen podle VS a nic se neučí.
 */
export function resolveGpcStatement(bytes: Uint8Array, accounts: OrganizationAccount[]): ResolvedGpc {
  const auto = parseGpc(bytes);
  if (auto.dialect === "km") return finish(auto, "0100", "km");

  const raw = auto.headerAccountDigits ?? "";
  const ownAccounts = accountsByLocalNumber(accounts);
  for (const dialect of ["edition", "km"] as const) {
    const local = readHeaderAccount(raw, dialect);
    const bankCode = local ? ownAccounts.get(local) : undefined;
    if (!bankCode) continue;
    const profile = gpcProfileFor(bankCode);
    // Číslo sedí jen jedním dialektem; když banka v registru říká jiný,
    // výpis nečteme ani jedním -- to je rozpor, ne rozhodnutí.
    if (profile.dialect !== dialect) continue;
    return finish(parseGpc(bytes, { dialect, bankCode }), bankCode, dialect);
  }
  return finish(auto, null, "edition");
}

function finish(parsed: GpcParseResult, bankCode: string | null, dialect: GpcDialect): ResolvedGpc {
  const verified = bankCode !== null && gpcProfileFor(bankCode).verified && gpcProfileFor(bankCode).dialect === dialect;
  if (!verified) {
    for (const entry of parsed.entries)
      if (entry.payment) entry.payment.counterparty_account_verified = false;
  }
  return { parsed, bankCode, dialect, verified };
}
