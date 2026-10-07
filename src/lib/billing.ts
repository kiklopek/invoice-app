import { isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { isValidDic, isValidIco } from "@/lib/company-validation";
import { czechAccountToIban, isPlausibleCzechAccount, parseCzechAccount } from "@/lib/czech-payment";

// Předplatné Splatna: stav firmy, fakturační údaje a údaje Splatna jako
// dodavatele. Žádná síť ani databáze -- jen pravidla, aby šla testovat.

export type SubscriptionRow = { status: string; trial_ends_at: string | null; current_period_end: string | null };
export type SubscriptionState = "trial" | "active" | "expired";

export function subscriptionState(row: SubscriptionRow | null, now = new Date()): SubscriptionState {
  // Bez řádku (stávající data před zavedením předplatného) firmu nezamykáme.
  if (!row) return "active";
  if (row.status === "trial") return row.trial_ends_at && new Date(row.trial_ends_at) > now ? "trial" : "expired";
  if (row.status === "active") return !row.current_period_end || new Date(row.current_period_end) > now ? "active" : "expired";
  return "expired";
}

const DAY = 24 * 3600_000;

/** Upozornění 7 dní před koncem zkušební doby a po ní. */
export function trialWarning(row: SubscriptionRow | null, now = new Date()) {
  const state = subscriptionState(row, now);
  if (state === "expired") return { kind: "expired" as const, daysLeft: 0 };
  if (state !== "trial" || !row?.trial_ends_at) return null;
  const daysLeft = Math.ceil((new Date(row.trial_ends_at).getTime() - now.getTime()) / DAY);
  return daysLeft <= 7 ? { kind: "ending" as const, daysLeft } : null;
}

export type BillingDetails = { name: string; ico: string; dic: string; address: string; email: string };

export function normalizeBillingDetails(input: unknown): { ok: true; details: BillingDetails } | { ok: false; error: string } {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (key: string, max = 300) => (typeof source[key] === "string" ? (source[key] as string).trim().slice(0, max) : "");
  const details = {
    name: text("name", 200),
    ico: text("ico", 12).replace(/\s/g, ""),
    dic: text("dic", 14).replace(/\s/g, "").toUpperCase(),
    address: text("address"),
    email: normalizeEmail(text("email", 254)),
  };
  if (details.name.length < 2) return { ok: false, error: "Vyplňte název firmy pro fakturu." };
  if (!isValidIco(details.ico)) return { ok: false, error: "IČO pro fakturu neodpovídá kontrolní číslici." };
  if (details.dic && !isValidDic(details.dic)) return { ok: false, error: "DIČ má mít tvar CZ a 8 až 10 číslic." };
  if (!isValidEmail(details.email)) return { ok: false, error: "Zadejte platný e-mail, kam pošleme fakturu." };
  return { ok: true, details };
}

export type Supplier = {
  name: string;
  ico: string;
  dic: string | null;
  address: string;
  account: string;
  iban: string;
  vatPayer: boolean;
  email: string | null;
};

/** Údaje Splatna jako dodavatele na fakturách. Bez nich se nic nefakturuje. */
export function supplierConfiguration(env: Record<string, string | undefined> = process.env): Supplier | null {
  const name = env.SPLATNO_SUPPLIER_NAME?.trim();
  const ico = env.SPLATNO_SUPPLIER_ICO?.trim();
  const address = env.SPLATNO_SUPPLIER_ADDRESS?.trim();
  const account = env.SPLATNO_SUPPLIER_ACCOUNT?.trim();
  if (!name || !ico || !address || !account || !isValidIco(ico)) return null;
  const parsed = parseCzechAccount(account);
  const iban = parsed && isPlausibleCzechAccount(parsed) ? czechAccountToIban(account) : null;
  if (!iban) return null;
  return {
    name,
    ico,
    dic: env.SPLATNO_SUPPLIER_DIC?.trim() || null,
    address,
    account,
    iban,
    vatPayer: env.SPLATNO_SUPPLIER_VAT_PAYER?.trim() === "true",
    email: env.SPLATNO_SUPPLIER_EMAIL?.trim() || null,
  };
}

export const TRANSFER_DUE_DAYS = 7;

/**
 * Firmy, za které smí automat upomínek odesílat. Firma s prošlou zkušební
 * dobou nebo předplatným má odesílání pozastavené; upomínky jí zůstanou ve
 * frontě a odejdou po zaplacení. Firma bez řádku předplatného se nezastavuje.
 */
export function organizationsAllowedToSend(
  organizationIds: string[],
  rows: (SubscriptionRow & { organization_id: string })[],
  now = new Date(),
) {
  const byOrganization = new Map(rows.map((row) => [row.organization_id, row]));
  return organizationIds.filter((id) => subscriptionState(byOrganization.get(id) ?? null, now) !== "expired");
}
