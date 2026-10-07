import "server-only";

import { getAuthenticatedSession } from "@/lib/auth";
import { isOperatorEmail } from "@/lib/operator";

/** Přihlášený provozovatel s ověřenou 2FA, jinak null. */
export async function getOperatorSession() {
  const session = await getAuthenticatedSession();
  return session && isOperatorEmail(session.email) ? session : null;
}
