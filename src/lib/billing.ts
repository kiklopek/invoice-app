import { TRIAL_INVOICE_LIMIT } from "@/lib/plans";

// Předplatné Splatna: stav firmy podle řádku v `subscriptions` (zrcadlo
// Stripe). Žádná síť ani databáze -- jen pravidla, aby šla testovat.

export type SubscriptionRow = {
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  trial_invoices_used?: number | null;
  trial_invoice_limit?: number | null;
};
export type SubscriptionState = "needs_payment" | "trial" | "active" | "past_due" | "expired";

export function subscriptionState(row: SubscriptionRow | null, now = new Date()): SubscriptionState {
  // Bez řádku (stávající data před zavedením předplatného) firmu nezamykáme.
  if (!row) return "active";
  switch (row.status) {
    case "incomplete":
    case "incomplete_expired":
      return "needs_payment";
    case "trialing":
      return "trial";
    // Konec období neřešíme podle hodin: prodloužení hlásí Stripe a webhook
    // může mít zpoždění. Trvalé předplatné (R. Hlavica) konec nemá vůbec.
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    // Řádky z doby před Stripe (zkušební doba podle data).
    case "trial":
      return row.trial_ends_at && new Date(row.trial_ends_at) > now ? "trial" : "expired";
    default:
      return "expired";
  }
}

function trialUsage(row: SubscriptionRow) {
  const limit = row.trial_invoice_limit ?? TRIAL_INVOICE_LIMIT;
  const used = Math.max(0, row.trial_invoices_used ?? 0);
  return { used, limit };
}

export type InvoiceAllowance =
  | { ok: true; remaining: number | null }
  | { ok: false; code: "trial_invoice_limit" | "subscription_payment_required" | "subscription_expired"; message: string };

/** Smí firma založit fakturu? (Databáze to hlídá triggerem znovu.) */
export function invoiceAllowance(row: SubscriptionRow | null, now = new Date()): InvoiceAllowance {
  const state = subscriptionState(row, now);
  if (state === "needs_payment") {
    return { ok: false, code: "subscription_payment_required", message: "Pro vystavování faktur dokončete nastavení platby (Nastavení → Předplatné)." };
  }
  if (state === "expired") {
    return { ok: false, code: "subscription_expired", message: "Předplatné skončilo. Nové faktury půjde přidávat po obnovení tarifu (Nastavení → Předplatné)." };
  }
  if (state === "trial" && row) {
    const { used, limit } = trialUsage(row);
    if (used >= limit) {
      return { ok: false, code: "trial_invoice_limit", message: `Zkušební doba má nejvýš ${limit} faktur. Další přidáte po zahájení placeného tarifu (Nastavení → Předplatné).` };
    }
    return { ok: true, remaining: limit - used };
  }
  return { ok: true, remaining: null };
}

const DAY = 24 * 3600_000;

export type BillingNotice =
  | { kind: "trial_ending" | "trial_invoices" | "trial_limit"; daysLeft: number; used: number; limit: number }
  | { kind: "payment_failed" | "expired" | "needs_payment" };

/** Pruh v aplikaci: konec zkušební doby, docházející faktury, nezdařená platba. */
export function billingNotice(row: SubscriptionRow | null, now = new Date()): BillingNotice | null {
  const state = subscriptionState(row, now);
  if (state === "needs_payment") return { kind: "needs_payment" };
  if (state === "past_due") return { kind: "payment_failed" };
  if (state === "expired") return { kind: "expired" };
  if (state !== "trial" || !row) return null;
  const { used, limit } = trialUsage(row);
  const daysLeft = row.trial_ends_at ? Math.max(0, Math.ceil((new Date(row.trial_ends_at).getTime() - now.getTime()) / DAY)) : 0;
  if (used >= limit) return { kind: "trial_limit", daysLeft, used, limit };
  if (used >= limit - 5) return { kind: "trial_invoices", daysLeft, used, limit };
  if (row.trial_ends_at && daysLeft <= 3) return { kind: "trial_ending", daysLeft, used, limit };
  return null;
}

/**
 * Firmy, za které smí automat upomínek odesílat. Firma s ukončeným
 * předplatným nebo bez zadané karty má odesílání pozastavené; upomínky jí
 * zůstanou ve frontě. Firma bez řádku předplatného se nezastavuje.
 */
export function organizationsAllowedToSend(
  organizationIds: string[],
  rows: (SubscriptionRow & { organization_id: string })[],
  now = new Date(),
) {
  const byOrganization = new Map(rows.map((row) => [row.organization_id, row]));
  return organizationIds.filter((id) => {
    const state = subscriptionState(byOrganization.get(id) ?? null, now);
    return state !== "expired" && state !== "needs_payment";
  });
}
