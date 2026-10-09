// Tarify Splatna. Jediný zdroj cen pro ceník na landing page, onboarding i
// stránku Předplatné. Ve Stripe mají ceny lookup_key `splatno_<tarif>_<období>`
// (zakládá je scripts/stripe-setup.mjs odsud), takže se částky nikde jinde
// nepíšou. Ceny jsou bez DPH; částky jsou v haléřích, aby se nesčítala
// desetinná čísla.

export type PlanId = "start" | "profi" | "business";
export type BillingPeriod = "monthly" | "yearly";

export type Plan = {
  id: PlanId;
  name: string;
  note: string;
  monthlyCzk: number;
  featured?: boolean;
  features: string[];
};

/** Roční platba = 10 měsíčních cen (2 měsíce zdarma). */
export const YEARLY_MONTHS_PAID = 10;
export const VAT_RATE_PERCENT = 21;
export const TRIAL_DAYS = 14;
export const TRIAL_INVOICE_LIMIT = 50;

export const PLANS: Plan[] = [
  {
    id: "start",
    name: "Start",
    note: "Pro menší firmy, které začínají.",
    monthlyCzk: 790,
    features: ["Až 100 faktur měsíčně", "Základní funkce", "E-mailová podpora"],
  },
  {
    id: "profi",
    name: "Profi",
    note: "Pro rostoucí firmy.",
    monthlyCzk: 1590,
    featured: true,
    features: ["Až 500 faktur měsíčně", "Automatické upomínky", "Pokročilé reporty", "Prioritní podpora"],
  },
  {
    id: "business",
    name: "Business",
    note: "Pro větší firmy.",
    monthlyCzk: 2990,
    features: ["Neomezený počet faktur", "Všechny funkce", "Individuální nastavení", "Osobní podpora"],
  },
];

export function findPlan(id: string | null | undefined) {
  return PLANS.find((plan) => plan.id === id) ?? null;
}

export function isBillingPeriod(value: unknown): value is BillingPeriod {
  return value === "monthly" || value === "yearly";
}

function planOrThrow(planId: PlanId, period: BillingPeriod) {
  const plan = findPlan(planId);
  if (!plan) throw new Error("unknown_plan");
  if (!isBillingPeriod(period)) throw new Error("unknown_period");
  return plan;
}

/** Cena za období v celých korunách bez DPH (měsíc, nebo rok za 10 měsíců). */
export function periodPrice(planId: PlanId, period: BillingPeriod) {
  const plan = planOrThrow(planId, period);
  return period === "yearly" ? plan.monthlyCzk * YEARLY_MONTHS_PAID : plan.monthlyCzk;
}

/** Cena za měsíc v celých korunách bez DPH (u roční platby přepočtená). */
export function monthlyPrice(planId: PlanId, period: BillingPeriod) {
  const price = periodPrice(planId, period);
  return period === "yearly" ? Math.round(price / 12) : price;
}

export type Quote = {
  plan: PlanId;
  period: BillingPeriod;
  months: number;
  netHalere: number;
  vatHalere: number;
  grossHalere: number;
};

export function quote(planId: PlanId, period: BillingPeriod): Quote {
  const months = period === "yearly" ? 12 : 1;
  const netHalere = periodPrice(planId, period) * 100;
  const vatHalere = Math.round((netHalere * VAT_RATE_PERCENT) / 100);
  return { plan: planId, period, months, netHalere, vatHalere, grossHalere: netHalere + vatHalere };
}

export function formatCzk(halere: number) {
  return `${new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: halere % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(halere / 100).replace(/\s/g, " ")} Kč`;
}

/** Klíč ceny ve Stripe. */
export function lookupKey(planId: PlanId, period: BillingPeriod) {
  planOrThrow(planId, period);
  return `splatno_${planId}_${period}`;
}

export function parseLookupKey(key: string | null | undefined): { plan: PlanId; period: BillingPeriod } | null {
  const match = /^splatno_([a-z]+)_([a-z]+)$/.exec(key ?? "");
  if (!match) return null;
  const plan = findPlan(match[1]);
  return plan && isBillingPeriod(match[2]) ? { plan: plan.id, period: match[2] } : null;
}

export type PlanChoice = { plan: PlanId; period: BillingPeriod };
export type ChangeKind = "same" | "upgrade" | "downgrade";

/**
 * Jako u jiných SaaS (i Claude): vyšší tarif a přechod na roční platbu
 * platí hned s doplatkem poměrné části; nižší tarif a přechod na měsíční
 * platbu až od dalšího období, bez vracení peněz.
 */
export function changeKind(from: PlanChoice, to: PlanChoice): ChangeKind {
  if (from.plan === to.plan && from.period === to.period) return "same";
  if (from.period !== to.period) return to.period === "yearly" ? "upgrade" : "downgrade";
  return monthlyPrice(to.plan, to.period) > monthlyPrice(from.plan, from.period) ? "upgrade" : "downgrade";
}
