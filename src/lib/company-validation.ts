import { parseCzechAccount, isPlausibleCzechAccount } from "@/lib/czech-payment";
import { isValidPaymentAccount } from "./bank-accounts";
import { isValidEmail } from "./auth-policy";

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
  return account ? /[1-9]/.test(account.number) && account.bank !== "0000" && isPlausibleCzechAccount(account) : false;
}

export const COMPANY_INPUT_LIMITS = {
  name: 240, ico: 8, dic: 12, registered_address: 300, operating_address: 300,
  data_box_id: 7, phone: 40, email: 254, bank_account_czk: 32, bank_account_eur: 42,
} as const;

export function normalizeCompanyPhone(value: string) {
  return value.trim().replace(/[\s().-]/g, "").replace(/^00/, "+");
}

/** Formát čísla; dostupnost telefonu ani jeho majitele tím nepotvrzujeme. */
export function isValidCompanyPhone(value: string) {
  if (!/^[+\d\s().-]+$/.test(value) || value.length > COMPANY_INPUT_LIMITS.phone) return false;
  const number = normalizeCompanyPhone(value);
  if (number.startsWith("+420")) return /^\+420[2-9]\d{8}$/.test(number);
  return /^[2-9]\d{8}$/.test(number) || /^\+[1-9]\d{6,14}$/.test(number);
}

export function isValidDataBoxId(value: string) {
  return /^[a-z0-9]{7}$/i.test(value.trim());
}

const CONTROL_CHARACTERS = /\p{Cc}/u;

/** Adresy mohou být i zahraniční; nevyžadujeme konkrétní český zápis PSČ. */
export function isPlausibleCompanyAddress(value: string) {
  const address = value.trim();
  return address.length >= 3 && address.length <= COMPANY_INPUT_LIMITS.registered_address &&
    /\p{L}/u.test(address) && /\d/.test(address) && !CONTROL_CHARACTERS.test(address);
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
  registered_address?: string;
  operating_address?: string;
  data_box_id?: string;
  phone?: string;
}): CompanyFieldError[] {
  const errors: CompanyFieldError[] = [];

  if (!company.name?.trim()) {
    errors.push({ field: "name", message: "Vyplňte název firmy." });
  } else if (company.name.trim().length < 2 || company.name.length > COMPANY_INPUT_LIMITS.name || CONTROL_CHARACTERS.test(company.name)) {
    errors.push({ field: "name", message: "Název firmy musí mít 2 až 240 znaků a nesmí obsahovat řídicí znaky." });
  }
  if (!company.ico?.trim()) {
    errors.push({ field: "ico", message: "Vyplňte IČO." });
  } else if (!isValidIco(company.ico)) {
    errors.push({ field: "ico", message: "IČO neodpovídá kontrolní číslici. Zkontrolujte, jestli jste ho opsali správně." });
  }
  if (!company.email?.trim()) {
    errors.push({ field: "email", message: "Vyplňte kontaktní e-mail." });
  } else if (!isValidEmail(company.email)) {
    errors.push({ field: "email", message: "E-mail nemá platný tvar." });
  }
  if (company.dic?.trim() && !isValidDic(company.dic)) {
    errors.push({ field: "dic", message: "DIČ má mít tvar CZ a 8 až 10 číslic." });
  }
  for (const field of ["registered_address", "operating_address"] as const) {
    if (company[field]?.trim() && !isPlausibleCompanyAddress(company[field])) {
      errors.push({ field, message: "Zadejte úplnou adresu včetně obce a čísla domu, nejvýš 300 znaků." });
    }
  }
  if (company.phone?.trim() && !isValidCompanyPhone(company.phone)) {
    errors.push({ field: "phone", message: "Zadejte 9místné české číslo nebo mezinárodní číslo s předvolbou, např. +420 777 123 456." });
  }
  if (company.data_box_id?.trim() && !isValidDataBoxId(company.data_box_id)) {
    errors.push({ field: "data_box_id", message: "ID datové schránky musí mít přesně 7 písmen nebo číslic, např. abc1234." });
  }
  const czk = company.bank_account_czk?.trim();
  if (czk && !isValidBankAccount(czk)) {
    errors.push({
      field: "bank_account_czk",
      message: "Zadejte korunový účet ve tvaru předčíslí-číslo/kód banky. Číslo neprošlo kontrolní číslicí — chybný účet rozbije párování plateb.",
    });
  }
  // Eurový účet bývá i zahraniční (slovenský, Wise…): přijme se i platný IBAN.
  const eur = company.bank_account_eur?.trim();
  if (eur && (eur.length > COMPANY_INPUT_LIMITS.bank_account_eur || !isValidPaymentAccount(eur) || (/^[\d\s/-]+$/.test(eur) && !isValidBankAccount(eur)))) {
    errors.push({
      field: "bank_account_eur",
      message: "Zadejte eurový účet ve tvaru předčíslí-číslo/kód banky nebo jako IBAN. Číslo neprošlo kontrolní číslicí — chybný účet rozbije párování plateb.",
    });
  }
  return errors;
}
