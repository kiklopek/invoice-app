"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, Headset } from "./landing-icons";
import styles from "./landing.module.css";

import { PLANS, TRIAL_DAYS, TRIAL_INVOICE_LIMIT, monthlyPrice, periodPrice } from "@/lib/plans";

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
            aria-label="Roční platba: 2 měsíce zdarma"
            className={styles.switch}
            data-on={yearly || undefined}
            onClick={() => setYearly((v) => !v)}
          >
            <span />
          </button>
          <span className={yearly ? styles.billingActive : undefined}>Ročně</span>
          <span className={styles.billingSave}>2 měsíce zdarma</span>
        </div>
      </div>

      <div className={styles.plans}>
        {PLANS.map((plan) => {
          const price = monthlyPrice(plan.id, yearly ? "yearly" : "monthly");
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
                {yearly ? `${czk.format(periodPrice(plan.id, "yearly"))} Kč ročně bez DPH` : "bez DPH"}
              </p>
              <ul>
                {plan.features.map((f) => (
                  <li key={f}>
                    <Check />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={`${trialHref}?tarif=${plan.id}&obdobi=${yearly ? "yearly" : "monthly"}`}
                className={plan.featured ? styles.btnPrimary : styles.btnOutline}
              >
                Vyzkoušet {TRIAL_DAYS} dní zdarma
              </Link>
              <p className={styles.planTrial}>Až {TRIAL_INVOICE_LIMIT} faktur ve zkušební době. Zrušit můžete kdykoli.</p>
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
