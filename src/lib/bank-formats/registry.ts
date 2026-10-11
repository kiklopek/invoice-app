import type { GpcDialect } from "@/lib/gpc-parser";

// Registr bank pro výpisy. Banka se pozná podle kódu banky (z hlavičky
// výpisu nebo z účtu firmy, ke kterému výpis patří) a k ní patří její
// „klíč“ -- dialekt formátu. Povinné čtení: docs/bank-formats/kb-gpc-km.md.
//
// Dialekt se nehádá z obsahu souboru. Banka je `verified` jen tehdy, když
// v docs/bank-formats/ leží její oficiální specifikace, souhrn a anonymizovaný
// reálný výpis jako fixture s testem (mod-11 všech účtů, zlaté hodnoty).
// Neověřená banka se čte v prostém (edičním) tvaru a čísla účtů z jejího
// výpisu se nepovažují za ověřená: párování jen podle VS, nic se neučí.

export const CZECH_BANKS: Record<string, string> = {
  "0100": "Komerční banka",
  "0300": "ČSOB",
  "0600": "MONETA Money Bank",
  "0710": "Česká národní banka",
  "0800": "Česká spořitelna",
  "2010": "Fio banka",
  "2060": "Citfin",
  "2250": "Banka CREDITAS",
  "2700": "UniCredit Bank",
  "3030": "Air Bank",
  "3060": "PKO BP",
  "5500": "Raiffeisenbank",
  "5800": "J&T Banka",
  "6100": "Equa bank",
  "6210": "mBank",
  "6700": "Všeobecná úverová banka",
  "8040": "Oberbank",
};

export type GpcProfile = { dialect: GpcDialect; verified: boolean; spec?: string };

const GPC_PROFILES: Record<string, GpcProfile> = {
  "0100": { dialect: "km", verified: true, spec: "docs/bank-formats/kb-gpc-km.md" },
};

/** Klíč pro výpis GPC dané banky; neznámá banka = prostý tvar, neověřeno. */
export function gpcProfileFor(bankCode: string | null | undefined): GpcProfile {
  return (bankCode && GPC_PROFILES[bankCode]) || { dialect: "edition", verified: false };
}

export function bankName(bankCode: string | null | undefined) {
  return (bankCode && CZECH_BANKS[bankCode]) || null;
}

/** Banky s ověřeným formátem výpisu (pro texty v onboardingu a importu). */
export function verifiedStatementBanks() {
  return Object.entries(GPC_PROFILES)
    .filter(([, profile]) => profile.verified)
    .map(([code]) => ({ code, name: CZECH_BANKS[code] ?? code, format: "GPC" }));
}
