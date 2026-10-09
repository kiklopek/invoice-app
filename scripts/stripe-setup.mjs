// Založí ve Stripe produkty, ceny a portál pro předplatné Splatna podle
// src/lib/plans.ts (jediný zdroj cen). Dá se pouštět opakovaně: co sedí,
// nechá být; změněnou cenu založí znovu a přesune na ni lookup_key
// (stará cena zůstane u stávajících předplatných, dokud je nezměníte).
//
//   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-setup.mjs          # bez DPH
//   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-setup.mjs --vat    # + DPH 21 %
//
// Nejdřív vždy s testovacím klíčem. Na ostrý klíč (sk_live_) se ptá.
import Stripe from "stripe";
import { createInterface } from "node:readline/promises";
import { PLANS, VAT_RATE_PERCENT, lookupKey, periodPrice } from "../src/lib/plans.ts";

const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key || !/^(sk|rk)_(test|live)_/.test(key)) {
  console.error("Nastavte STRIPE_SECRET_KEY (sk_test_… nebo sk_live_…).");
  process.exit(1);
}
if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Ostrý Stripe účet. Opravdu založit produkty a ceny? (ano/ne) ");
  rl.close();
  if (answer.trim().toLowerCase() !== "ano") process.exit(0);
}

const stripe = new Stripe(key);
const withVat = process.argv.includes("--vat");

const products = (await stripe.products.list({ active: true, limit: 100 })).data;
for (const plan of PLANS) {
  let product = products.find((item) => item.metadata?.splatno_plan === plan.id);
  if (!product) {
    product = await stripe.products.create({
      name: `Splatno ${plan.name}`,
      description: plan.note,
      metadata: { splatno_plan: plan.id },
      tax_code: "txcd_10103001", // SaaS pro firmy
    });
    console.log(`Produkt ${product.name}: založen (${product.id})`);
  } else {
    console.log(`Produkt ${product.name}: existuje (${product.id})`);
  }

  for (const period of ["monthly", "yearly"]) {
    const lookup = lookupKey(plan.id, period);
    const amount = periodPrice(plan.id, period) * 100;
    const existing = (await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 })).data[0];
    if (existing && existing.unit_amount === amount && existing.currency === "czk" && existing.tax_behavior === "exclusive") {
      console.log(`  ${lookup}: ${amount / 100} Kč, beze změny (${existing.id})`);
      continue;
    }
    const price = await stripe.prices.create({
      product: product.id,
      currency: "czk",
      unit_amount: amount,
      tax_behavior: "exclusive",
      recurring: { interval: period === "yearly" ? "year" : "month" },
      lookup_key: lookup,
      transfer_lookup_key: true,
      nickname: `${plan.name} ${period === "yearly" ? "ročně" : "měsíčně"}`,
    });
    console.log(`  ${lookup}: ${amount / 100} Kč, ${existing ? "nová cena (stará zůstává u stávajících předplatných)" : "založena"} (${price.id})`);
  }
}

let taxRateId = null;
if (withVat) {
  const rates = (await stripe.taxRates.list({ active: true, limit: 100 })).data;
  let rate = rates.find((item) => item.metadata?.splatno === "dph" && item.percentage === VAT_RATE_PERCENT && !item.inclusive);
  if (!rate) {
    rate = await stripe.taxRates.create({
      display_name: "DPH",
      percentage: VAT_RATE_PERCENT,
      inclusive: false,
      country: "CZ",
      jurisdiction: "CZ",
      description: `DPH ${VAT_RATE_PERCENT} %`,
      metadata: { splatno: "dph" },
    });
  }
  taxRateId = rate.id;
  console.log(`DPH ${VAT_RATE_PERCENT} %: ${rate.id}`);
}

// Portál: karta, fakturační údaje a faktury. Tarif a zrušení se mění ve
// Splatnu (stránka Předplatné), aby platila stejná pravidla a potvrzení.
const configurations = (await stripe.billingPortal.configurations.list({ active: true, limit: 10 })).data;
const portal = configurations.find((item) => item.metadata?.splatno === "portal") ?? await stripe.billingPortal.configurations.create({
  business_profile: { headline: "Splatno – platby a faktury za předplatné" },
  features: {
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id", "name"] },
    subscription_cancel: { enabled: false },
    subscription_update: { enabled: false },
  },
  metadata: { splatno: "portal" },
});
console.log(`Portál: ${portal.id}${portal.is_default ? " (výchozí)" : " – nastavte ho v Dashboardu jako výchozí"}`);

console.log("\nDo prostředí (Vercel / .env.local):");
console.log(`STRIPE_SECRET_KEY=${key.slice(0, 8)}…`);
console.log("STRIPE_WEBHOOK_SECRET=whsec_…  (Dashboard → Developers → Webhooks)");
if (taxRateId) console.log(`STRIPE_TAX_RATE_ID=${taxRateId}`);
