import { pathToFileURL } from "node:url";

// Shodné s TRUSTED_EMAIL_MFA_ACCOUNT v src/lib/email-mfa-core.ts (hlídá test).
export const MFA_BYPASS_ACCOUNT = "test-admin@hlavica.cz";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_BASE_URL",
  "RESEND_API_KEY",
  "REMINDER_EMAIL_FROM",
  "AUTH_EMAIL_FROM",
  "AUTH_EMAIL_DELIVERY_ENABLED",
  "RESEND_WEBHOOK_SECRET",
  "EMAIL_MFA_SECRET",
  "CRON_SECRET",
];

export function validateProductionEnv(env = process.env) {
  const production = env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
  if (!production) return [];

  const errors = required
    .filter((name) => !env[name]?.trim())
    .map((name) => `Chybí produkční proměnná ${name}.`);

  if (env.EMAIL_MFA_BYPASS_EMAILS?.trim()) {
    errors.push("EMAIL_MFA_BYPASS_EMAILS musí být v produkci prázdné.");
  }
  if (env.VERCEL_ENV === "production" && env.REMINDER_TEST_RECIPIENTS?.trim()) {
    errors.push("REMINDER_TEST_RECIPIENTS musí být v produkci prázdné.");
  }
  // Provozovatel = support vstup do libovolné firmy, vždy s ověřením kódem.
  // Účet bez ověření (TRUSTED_EMAIL_MFA_ACCOUNT v src/lib/email-mfa-core.ts)
  // provozovatelem být nesmí. Vyžaduje se jen na produkčním nasazení.
  if (env.VERCEL_ENV === "production") {
    const operators = (env.SPLATNO_OPERATOR_EMAILS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (!operators.length) errors.push("Chybí produkční proměnná SPLATNO_OPERATOR_EMAILS.");
    if (operators.includes(MFA_BYPASS_ACCOUNT)) {
      errors.push(`SPLATNO_OPERATOR_EMAILS nesmí obsahovat účet bez ověření kódem (${MFA_BYPASS_ACCOUNT}).`);
    }
  }
  if ((env.EMAIL_MFA_SECRET?.trim().length ?? 0) < 32) {
    errors.push("EMAIL_MFA_SECRET musí mít alespoň 32 znaků.");
  }
  if ((env.CRON_SECRET?.trim().length ?? 0) < 16) {
    errors.push("CRON_SECRET musí mít alespoň 16 znaků.");
  }
  if (env.AUTH_EMAIL_DELIVERY_ENABLED?.trim().toLowerCase() !== "true") {
    errors.push("AUTH_EMAIL_DELIVERY_ENABLED musí být v produkci nastavené na true.");
  }
  try {
    const baseUrl = new URL(env.APP_BASE_URL ?? "");
    if (baseUrl.protocol !== "https:") errors.push("APP_BASE_URL musí v produkci používat HTTPS.");
  } catch {
    errors.push("APP_BASE_URL musí být platná absolutní URL.");
  }
  return [...new Set(errors)];
}

export function assertProductionEnv(env = process.env) {
  const errors = validateProductionEnv(env);
  if (!errors.length) return;
  for (const error of errors) console.error(`[production-env] ${error}`);
  throw new Error("Produkční konfigurace není bezpečná.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assertProductionEnv();
  } catch {
    process.exitCode = 1;
  }
}
