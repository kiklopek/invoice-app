import "server-only";
import { createServiceClient } from "@/lib/supabase-server";

export class EmailSuppressedError extends Error {
  constructor() { super("Na tuto adresu nelze odesílat. Je blokovaná po odmítnutí zprávy nebo označení jako spam."); }
}

/** Last shared gate before any invoice/reminder transport, including CC. */
export async function assertEmailRecipientsNotSuppressed(organizationId: string, recipients: string[]) {
  const emails = [...new Set(recipients.map(email => email.trim().toLowerCase()))];
  const { data, error } = await createServiceClient().from("email_suppressions")
    .select("email").eq("organization_id", organizationId).in("email", emails).limit(1);
  if (error) throw new Error("Stav e-mailové adresy se nepodařilo ověřit.");
  if (data?.length) throw new EmailSuppressedError();
}
