export class LocalEmailRecipientBlockedError extends Error {
  readonly code = "LOCAL_EMAIL_RECIPIENT_BLOCKED";

  constructor() {
    super("LOCAL_EMAIL_RECIPIENT_BLOCKED");
    this.name = "LocalEmailRecipientBlockedError";
  }
}

export function assertLocalEmailRecipientsAllowed(recipients: Array<string | null | undefined>) {
  if (process.env.NODE_ENV === "production") return;
  const configured = process.env.LOCAL_EMAIL_RECIPIENT_ALLOWLIST?.trim();
  if (!configured) return;
  const allowed = new Set(configured.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  const requested = recipients.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim().toLowerCase());
  if (requested.some((recipient) => !allowed.has(recipient))) throw new LocalEmailRecipientBlockedError();
}
