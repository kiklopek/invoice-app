import "server-only";

import { isIssuerReminderAddress } from "./reminder-recipient-safety";

// Testovací schránky (REMINDER_TEST_RECIPIENTS, čárkami oddělené) smí
// dostat upomínku, i když vypadají jako adresa vystavitele. Jen mimo
// produkci: tam by výjimka měnila pravidla adresátů všem firmám.
// OCR extraction deliberately continues using the stricter issuer check.
function testRecipients(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (env.VERCEL_ENV === "production") return new Set<string>();
  return new Set((env.REMINDER_TEST_RECIPIENTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean));
}

export function isBlockedReminderRecipient(
  recipient: string | null | undefined,
  issuer: { name?: string | null; email?: string | null },
) {
  const normalized = recipient?.trim().toLowerCase();
  if (normalized && testRecipients().has(normalized)) return false;
  return isIssuerReminderAddress(recipient, issuer);
}
