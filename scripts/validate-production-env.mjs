import { pathToFileURL } from "node:url";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_BASE_URL",
  "RESEND_API_KEY",
  "REMINDER_EMAIL_FROM",
  "AUTH_EMAIL_FROM",
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
  if ((env.EMAIL_MFA_SECRET?.trim().length ?? 0) < 32) {
    errors.push("EMAIL_MFA_SECRET musí mít alespoň 32 znaků.");
  }
  if ((env.CRON_SECRET?.trim().length ?? 0) < 16) {
    errors.push("CRON_SECRET musí mít alespoň 16 znaků.");
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
