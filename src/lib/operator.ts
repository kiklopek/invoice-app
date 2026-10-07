import { normalizeEmail } from "@/lib/auth-policy";

// Provozovatel Splatna (ty): ruční ověření firem a potvrzení plateb převodem.
// Seznam e-mailů je v SPLATNO_OPERATOR_EMAILS; přístup navíc vyžaduje
// přihlášení s 2FA (getAuthenticatedSession).
export function isOperatorEmail(email: string | null | undefined, env: Record<string, string | undefined> = process.env) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return (env.SPLATNO_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter(Boolean)
    .includes(normalized);
}
