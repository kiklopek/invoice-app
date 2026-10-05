import "server-only";

import { isIssuerReminderAddress } from "./reminder-recipient-safety";

// Explicit invoice/customer contacts may use this one testing mailbox.
// OCR extraction deliberately continues using the stricter issuer check.
export function isBlockedReminderRecipient(
  recipient: string | null | undefined,
  issuer: { name?: string | null; email?: string | null },
) {
  if (process.env.ALLOW_ADAM_REMINDER_TEST_EMAIL === "true"
      && recipient?.trim().toLowerCase() === "adam@hlavica.cz") return false;
  return isIssuerReminderAddress(recipient, issuer);
}
