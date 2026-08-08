export const ALLOWED_EMAIL_DOMAIN = "hlavica.cz";

export function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function isCorporateEmailRequired() {
  // The relaxed policy is deliberately tied to the runtime mode. It cannot be
  // enabled by an environment flag on a production deployment.
  return process.env.NODE_ENV === "production";
}

export function isAllowedCorporateEmail(value: string | null | undefined) {
  const email = normalizeEmail(value);
  if (!email) return false;
  const parts = email.split("@");
  const isValidEmail =
    parts.length === 2 &&
    Boolean(parts[0]) &&
    Boolean(parts[1]) &&
    !parts[1].startsWith(".") &&
    !parts[1].endsWith(".") &&
    parts[1].includes(".");

  if (!isValidEmail) return false;
  return !isCorporateEmailRequired() || parts[1] === ALLOWED_EMAIL_DOMAIN;
}
