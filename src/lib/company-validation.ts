import { parseCzechAccount, isPlausibleCzechAccount } from "@/lib/czech-payment";

// Firemní údaje se dřív neověřovaly vůbec (kromě "IČO má osm číslic").
// Chybné číslo bankovního účtu je přitom nejdražší překlep v aplikaci:
// projeví se až za týden jako "platby nedorazily", protože párování
// bankovních výpisů hlásí neshodu účtu a nic se nezaúčtuje.

/**
 * České IČO: sedm číslic plus kontrolní, vážená mod-11.
 * Osm číslic samo o sobě nestačí -- "12345678" je osmimístné a přitom
 * neplatné.
 */
export function isValidIco(value: string): boolean {
  const ico = value.trim();
  if (!/^\d{8}$/.test(ico)) return false;
  let sum = 0;
  for (let index = 0; index < 7; index += 1) sum += Number(ico[index]) * (8 - index);
  const remainder = sum % 11;
  const check = remainder === 0 ? 1 : remainder === 1 ? 0 : 11 - remainder;
  return check % 10 === Number(ico[7]);
}

/** DIČ se v Česku skládá z "CZ" a daňového identifikátoru (8-10 číslic). */
export function isValidDic(value: string): boolean {
  return /^CZ\d{8,10}$/.test(value.trim().toUpperCase());
}

/** Číslo účtu v českém tvaru, včetně mod-11 na předčíslí i základu. */
export function isValidBankAccount(value: string): boolean {
  const account = parseCzechAccount(value);
  return account ? isPlausibleCzechAccount(account) : false;
}

export type CompanyFieldError = { field: string; message: string };

/**
 * Ověří jen vyplněná pole: prázdné nepovinné pole není chyba. Vrací seznam,
 * aby uživatel viděl všechny problémy najednou, ne jeden po druhém.
 */
export function validateCompanyFields(company: {
  name?: string;
  ico?: string;
  dic?: string;
  email?: string;
  bank_account_czk?: string;
  bank_account_eur?: string;
}): CompanyFieldError[] {
  const errors: CompanyFieldError[] = [];

  if (!company.name?.trim()) {
    errors.push({ field: "name", message: "Vyplňte název firmy." });
  }
  if (!company.ico?.trim()) {
    errors.push({ field: "ico", message: "Vyplňte IČO." });
  } else if (!isValidIco(company.ico)) {
    errors.push({ field: "ico", message: "IČO neodpovídá kontrolní číslici. Zkontrolujte, jestli jste ho opsali správně." });
  }
  if (!company.email?.trim()) {
    errors.push({ field: "email", message: "Vyplňte kontaktní e-mail." });
  } else if (!/^\S+@\S+\.\S+$/.test(company.email.trim())) {
    errors.push({ field: "email", message: "E-mail nemá platný tvar." });
  }
  if (company.dic?.trim() && !isValidDic(company.dic)) {
    errors.push({ field: "dic", message: "DIČ má mít tvar CZ a 8 až 10 číslic." });
  }
  for (const [field, label] of [["bank_account_czk", "korunový"], ["bank_account_eur", "eurový"]] as const) {
    const value = company[field]?.trim();
    if (value && !isValidBankAccount(value)) {
      errors.push({
        field,
        message: `Zadejte ${label} účet ve tvaru předčíslí-číslo/kód banky. Číslo neprošlo kontrolní číslicí — chybný účet rozbije párování plateb.`,
      });
    }
  }
  return errors;
}
