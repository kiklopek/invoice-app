import { normalizeCompanyPhone, validateCompanyFields, type CompanyFieldError } from "@/lib/company-validation";
import { isValidEmail } from "@/lib/auth-policy";
import { MAX_REMINDER_CC_RECIPIENTS, parseReminderCcInput } from "@/lib/reminder-recipients";

// Onboarding firmy (P5). Firma vzniká naráz až po posledním kroku; tady je
// jen to, co se na údajích kontroluje -- stejně v prohlížeči i na serveru.

export const ONBOARDING_FIELDS = [
  "name",
  "ico",
  "dic",
  "registered_address",
  "operating_address",
  "data_box_id",
  "phone",
  "email",
  "bank_account_czk",
  "bank_account_eur",
] as const;

export type OnboardingCompany = Record<(typeof ONBOARDING_FIELDS)[number], string>;

export const ONBOARDING_STEP_FIELDS = {
  1: ["name", "ico", "dic", "registered_address"],
  2: ["email", "phone", "data_box_id", "operating_address"],
  3: ["bank_account_czk", "bank_account_eur"],
} as const;

export function onboardingStepForField(field: string): 1 | 2 | 3 | null {
  for (const step of [1, 2, 3] as const) {
    if ((ONBOARDING_STEP_FIELDS[step] as readonly string[]).includes(field)) return step;
  }
  return null;
}

export function validateOnboardingReminders(reminders: { days: number[]; replyTo: string; ccText: string }): CompanyFieldError[] {
  const errors: CompanyFieldError[] = [];
  if (!reminders.days.length || reminders.days.some((day) => !Number.isInteger(day) || day < -90 || day > 365)) {
    errors.push({ field: "reminder_days", message: "Vyberte aspoň jeden den, kdy zákazníkovi připomenout fakturu." });
  }
  if (reminders.replyTo.trim() && !isValidEmail(reminders.replyTo)) errors.push({ field: "reminder_reply_to", message: "Adresa pro odpovědi nemá platný tvar." });
  const cc = parseReminderCcInput(reminders.ccText);
  if (cc.length > MAX_REMINDER_CC_RECIPIENTS || cc.some((email) => !isValidEmail(email))) {
    errors.push({ field: "reminder_cc", message: `Zadejte nejvýš ${MAX_REMINDER_CC_RECIPIENTS} platných e-mailů oddělených čárkou.` });
  }
  return errors;
}

export function normalizeOnboardingCompany(input: unknown): OnboardingCompany {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof source[key] === "string" ? (source[key] as string).trim() : "");
  return {
    name: text("name").replace(/\s+/g, " "),
    ico: text("ico").replace(/\s/g, ""),
    dic: text("dic").replace(/\s/g, "").toUpperCase(),
    registered_address: text("registered_address"),
    operating_address: text("operating_address"),
    data_box_id: text("data_box_id").toLowerCase(),
    phone: normalizeCompanyPhone(text("phone")),
    email: text("email").toLowerCase(),
    bank_account_czk: text("bank_account_czk").replace(/\s/g, ""),
    bank_account_eur: text("bank_account_eur").replace(/\s/g, "").toUpperCase(),
  };
}

export function validateOnboardingCompany(company: OnboardingCompany, { vatPayer = false }: { vatPayer?: boolean } = {}): CompanyFieldError[] {
  const errors = validateCompanyFields(company);
  if (!company.registered_address.trim()) errors.push({ field: "registered_address", message: "Vyplňte adresu sídla firmy." });
  if (vatPayer && !company.dic.trim()) errors.push({ field: "dic", message: "U plátce DPH vyplňte DIČ." });
  // Bez korunového účtu se nespáruje žádná platba, proto je v onboardingu
  // povinný (v nastavení firmy ho později jde změnit, ne smazat do prázdna).
  if (!company.bank_account_czk) {
    errors.push({ field: "bank_account_czk", message: "Vyplňte korunový bankovní účet, na který vám odběratelé platí." });
  }
  return errors;
}

const ONBOARDING_ERRORS: Record<string, { status: number; message: string }> = {
  already_member: { status: 409, message: "Váš účet už do firmy patří. Pokračujte na nástěnku." },
  pending_invitation: { status: 409, message: "Na váš e-mail čeká pozvánka do firmy. Otevřete odkaz z e-mailu s pozvánkou." },
  ico_taken: { status: 409, message: "Tato firma už ve Splatnu je. Požádejte jejího administrátora o pozvánku." },
  invalid_ico: { status: 400, message: "IČO neodpovídá kontrolní číslici." },
  invalid_name: { status: 400, message: "Vyplňte název firmy." },
  invalid_email: { status: 400, message: "Kontaktní e-mail nemá platný tvar." },
};

export function onboardingErrorMessage(databaseMessage: string | null | undefined) {
  if (!databaseMessage) return null;
  const code = Object.keys(ONBOARDING_ERRORS).find((key) => databaseMessage.includes(key));
  return code ? { code, ...ONBOARDING_ERRORS[code] } : null;
}
