"use client";

import { useState } from "react";
import { ArrowRight, Check, Headset } from "./landing-icons";
import styles from "./landing.module.css";

const YEARLY_DISCOUNT = 0.2;

const plans = [
  {
    name: "Start",
    note: "Pro menší firmy, které začínají.",
    monthly: 790,
    features: ["Až 100 faktur měsíčně", "Základní funkce", "E-mailová podpora"],
  },
  {
    name: "Profi",
    note: "Pro rostoucí firmy.",
    monthly: 1590,
    featured: true,
    features: [
      "Až 500 faktur měsíčně",
      "Automatické upomínky",
      "Pokročilé reporty",
      "Prioritní podpora",
    ],
  },
  {
    name: "Business",
    note: "Pro větší firmy.",
    monthly: 2990,
    features: [
      "Neomezený počet faktur",
      "Všechny funkce",
      "Individuální nastavení",
      "Osobní podpora",
    ],
  },
];

const czk = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });

export function Pricing({ contactHref, trialHref }: { contactHref: string; trialHref: string }) {
  const [yearly, setYearly] = useState(false);

  return (
    <>
      <div className={styles.pricingHead}>
        <div>
          <span className={styles.eyebrow}>Ceník</span>
          <h2 className={styles.h2}>Jednoduché a transparentní tarify.</h2>
        </div>
        <div className={styles.billing}>
          <span className={yearly ? undefined : styles.billingActive}>Měsíčně</span>
          <button
            type="button"
            role="switch"
            aria-checked={yearly}
            aria-label="Roční platba se slevou 20 %"
            className={styles.switch}
            data-on={yearly || undefined}
            onClick={() => setYearly((v) => !v)}
          >
            <span />
          </button>
          <span className={yearly ? styles.billingActive : undefined}>Ročně</span>
          <span className={styles.billingSave}>−20 %</span>
        </div>
      </div>

      <div className={styles.plans}>
        {plans.map((plan) => {
          const price = yearly
            ? Math.round(plan.monthly * (1 - YEARLY_DISCOUNT))
            : plan.monthly;
          return (
            <article
              key={plan.name}
              className={`${styles.plan} ${plan.featured ? styles.planFeatured : ""}`}
            >
              {plan.featured ? <span className={styles.planBadge}>Nejoblíbenější</span> : null}
              <h3>{plan.name}</h3>
              <p className={styles.planNote}>{plan.note}</p>
              <p className={styles.planPrice}>
                <strong>{czk.format(price)} Kč</strong> <span>/ měsíc</span>
              </p>
              <p className={styles.planBilled}>
                {yearly ? `${czk.format(price * 12)} Kč ročně` : " "}
              </p>
              <ul>
                {plan.features.map((f) => (
                  <li key={f}>
                    <Check />
                    {f}
                  </li>
                ))}
              </ul>
              <a href={trialHref} className={plan.featured ? styles.btnPrimary : styles.btnOutline}>
                Vyzkoušet zdarma
              </a>
            </article>
          );
        })}

        <aside className={styles.planCustom}>
          <Headset className={styles.planCustomIcon} />
          <h3>Potřebujete jiný plán?</h3>
          <p>Rádi s vámi najdeme řešení na míru.</p>
          <a href={contactHref} className={styles.textLink}>
            Kontaktovat nás <ArrowRight />
          </a>
        </aside>
      </div>
    </>
  );
}
