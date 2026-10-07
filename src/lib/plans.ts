// Tarify Splatna. Jediný zdroj cen pro ceník na landing page i pro
// objednávku: částku objednávky vždy počítá server odsud, nikdy ji nebere
// z prohlížeče. Ceny jsou bez DPH; částky objednávky jsou v haléřích, aby
// se nesčítala desetinná čísla.

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

export const YEARLY_DISCOUNT = 0.2;
export const VAT_RATE_PERCENT = 21;

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

/** Cena za měsíc v celých korunách bez DPH (roční platba se slevou). */
export function monthlyPrice(planId: PlanId, period: BillingPeriod) {
  const plan = findPlan(planId);
  if (!plan) throw new Error("unknown_plan");
  if (!isBillingPeriod(period)) throw new Error("unknown_period");
  return period === "yearly" ? Math.round(plan.monthlyCzk * (1 - YEARLY_DISCOUNT)) : plan.monthlyCzk;
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
  const netHalere = monthlyPrice(planId, period) * months * 100;
  const vatHalere = Math.round((netHalere * VAT_RATE_PERCENT) / 100);
  return { plan: planId, period, months, netHalere, vatHalere, grossHalere: netHalere + vatHalere };
}

export function formatCzk(halere: number) {
  return `${new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: halere % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(halere / 100).replace(/\s/g, " ")} Kč`;
}
