import { normalizeEmail } from "@/lib/auth-policy";
import { isEmailMfaBypassed } from "@/lib/email-mfa-core";

// Provozovatel Splatna (ty): přehled firem a jejich předplatného na /provoz.
// Seznam e-mailů je v SPLATNO_OPERATOR_EMAILS; přístup navíc vyžaduje
// přihlášení s 2FA (getAuthenticatedSession).
export function isOperatorEmail(email: string | null | undefined, env: Record<string, string | undefined> = process.env) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  // Provozovatel smí do cizích firem (support), takže vždy s 2FA.
  if (isEmailMfaBypassed(normalized)) return false;
  return (env.SPLATNO_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter(Boolean)
    .includes(normalized);
}
