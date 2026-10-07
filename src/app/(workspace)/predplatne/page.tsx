import type { Metadata } from "next";
import { PricingCheckout } from "./pricing-checkout";

export const metadata: Metadata = { title: "Předplatné | Splatno" };

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ tarif?: string; obdobi?: string }> }) {
  const params = await searchParams;
  return <PricingCheckout initialPlan={params.tarif ?? null} initialPeriod={params.obdobi ?? null} />;
}
