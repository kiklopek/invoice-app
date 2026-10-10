import type { Locale } from "./locales";

// Hlášky z API přihlášení a pozvánek přicházejí česky v poli `error` a
// k tomu se strojovým `code`. Česky se ukáže text ze serveru beze změny;
// v angličtině se přeloží podle `code`, neznámý kód dostane obecný text.
// Serverové routy se tak kvůli jazyku nemění.

type ApiErrorBody = { error?: unknown; code?: unknown } | null | undefined;

const EN_MFA_ERRORS: Record<string, string> = {
  origin_denied: "The request came from a website that isn't allowed.",
  unauthorized: "You're not signed in.",
  mfa_unavailable: "E-mail verification isn't configured.",
  mfa_challenge_failed: "The verification code couldn't be prepared.",
  rate_limited: "You can request a new code in one minute.",
  mfa_delivery_failed: "The code couldn't be sent. Try again in one minute.",
  invalid_code: "The code isn't correct.",
  challenge_missing: "The code isn't active. Request a new one.",
  challenge_expired: "The code has expired or been locked. Request a new one.",
  mfa_verification_failed: "The code couldn't be verified.",
  mfa_session_failed: "The verification couldn't be stored securely. Please log in again.",
};

const EN_INVITATION_ERRORS: Record<string, string> = {
  origin_denied: "The request came from a website that isn't allowed.",
  invitation_not_found: "This link is no longer valid. Ask your administrator for a new invitation.",
  invitation_expired: "The invitation has expired. Ask your administrator for a new one.",
  terms_required: "You need to agree to the terms to join.",
  name_required: "Enter your full name.",
  weak_password: "The password must be at least 12 characters long and contain upper- and lowercase letters and a number.",
  rate_limited: "Too many attempts. Try again in a few minutes.",
  invitation_unavailable: "We couldn't verify the invitation right now. Please try again in a moment.",
  account_create_failed: "The account couldn't be created. Please try again.",
  account_sign_in_failed: "The account couldn't be completed. Please try again.",
  existing_account_password: "You already have an account for this e-mail. Enter its current password.",
  invitation_accept_failed: "The invitation couldn't be accepted.",
  invalid_email: "Enter a valid e-mail address.",
  email_domain_not_allowed: "Only e-mails from the company domain can be added to this company.",
  member_of_other_organization: "This e-mail already belongs to another company in Splatno. One account can only be in one company for now.",
  not_pending: "This person has already accepted the invitation.",
  email_mismatch: "The invitation is meant for a different e-mail.",
};

function localize(messages: Record<string, string>, locale: Locale, body: ApiErrorBody, fallback: string) {
  if (locale === "cs") return typeof body?.error === "string" && body.error ? body.error : fallback;
  const code = typeof body?.code === "string" ? body.code : null;
  return (code && messages[code]) || fallback;
}

export function mfaApiError(locale: Locale, body: ApiErrorBody, fallback: string) {
  return localize(EN_MFA_ERRORS, locale, body, fallback);
}

export function invitationApiError(locale: Locale, body: ApiErrorBody, fallback: string) {
  return localize(EN_INVITATION_ERRORS, locale, body, fallback);
}
