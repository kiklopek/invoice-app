import { describe, expect, it } from "vitest";
import { validateProductionEnv } from "../../scripts/validate-production-env.mjs";

const validProductionEnv = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  APP_BASE_URL: "https://www.splatno.cz",
  RESEND_API_KEY: "resend",
  REMINDER_EMAIL_FROM: "Splatno <upominky@mail.splatno.cz>",
  AUTH_EMAIL_FROM: "Splatno <prihlaseni@mail.splatno.cz>",
  AUTH_EMAIL_DELIVERY_ENABLED: "true",
  RESEND_WEBHOOK_SECRET: "webhook",
  EMAIL_MFA_SECRET: "a-secure-secret-with-at-least-32-characters",
  EMAIL_MFA_BYPASS_EMAILS: "",
  CRON_SECRET: "a-long-cron-secret",
} as const;

describe("production environment validation", () => {
  it("accepts a complete production configuration", () => {
    expect(validateProductionEnv(validProductionEnv)).toEqual([]);
  });

  it("blocks an MFA bypass in production", () => {
    expect(validateProductionEnv({
      ...validProductionEnv,
      EMAIL_MFA_BYPASS_EMAILS: "test-admin@hlavica.cz",
    })).toContain("EMAIL_MFA_BYPASS_EMAILS musí být v produkci prázdné.");
  });

  it("blocks production when authentication e-mail delivery is disabled", () => {
    expect(validateProductionEnv({
      ...validProductionEnv,
      AUTH_EMAIL_DELIVERY_ENABLED: "false",
    })).toContain("AUTH_EMAIL_DELIVERY_ENABLED musí být v produkci nastavené na true.");
  });

  it("does not require production secrets for local development", () => {
    expect(validateProductionEnv({ NODE_ENV: "development" })).toEqual([]);
  });
});
