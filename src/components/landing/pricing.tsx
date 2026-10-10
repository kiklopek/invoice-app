"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { useI18n } from "@/i18n/client";
import { formatCzk } from "@/i18n/format";
import { ArrowRight, Check, Headset } from "./landing-icons";
import styles from "./landing.module.css";

import { PLANS, TRIAL_DAYS, TRIAL_INVOICE_LIMIT, monthlyPrice, periodPrice } from "@/lib/plans";

// Ceny a tarify jsou z @/lib/plans; popisy tarifů pro ceník jsou ve slovníku
// podle id tarifu, aby šly přeložit (plans.ts zůstává česky pro aplikaci).
export function Pricing({ contactHref, trialHref }: { contactHref: string; trialHref: string }) {
  const [yearly, setYearly] = useState(false);
  const { locale, t } = useI18n();
  const copy = t.pricing;

  return (
    <>
      <div className={styles.pricingHead} data-reveal="">
        <div>
          <span className={styles.eyebrow}>{copy.eyebrow}</span>
          <h2 className={styles.h2}>{copy.title}</h2>
        </div>
        <div className={styles.billing}>
          <span className={yearly ? undefined : styles.billingActive}>{copy.monthly}</span>
          <button
            type="button"
            role="switch"
            aria-checked={yearly}
            aria-label={copy.switchAria}
            className={styles.switch}
            data-on={yearly || undefined}
            onClick={() => setYearly((v) => !v)}
          >
            <span />
          </button>
          <span className={yearly ? styles.billingActive : undefined}>{copy.yearly}</span>
          <span className={styles.billingSave}>{copy.save}</span>
        </div>
        {/* Mobilní varianta: dva segmenty ovladatelné palcem místo malého přepínače. */}
        <div className={styles.billingSeg} role="radiogroup" aria-label={copy.periodAria}>
          <button type="button" role="radio" aria-checked={!yearly} data-on={!yearly || undefined} onClick={() => setYearly(false)}>
            {copy.monthly}
          </button>
          <button type="button" role="radio" aria-checked={yearly} data-on={yearly || undefined} onClick={() => setYearly(true)}>
            {copy.yearly} <span className={styles.billingSave}>{copy.save}</span>
          </button>
        </div>
      </div>

      <div className={styles.plans}>
        {PLANS.map((plan, index) => {
          const price = monthlyPrice(plan.id, yearly ? "yearly" : "monthly");
          const planCopy = copy.plans[plan.id];
          return (
            <article
              key={plan.name}
              className={`${styles.plan} ${plan.featured ? styles.planFeatured : ""}`}
              data-reveal=""
              style={{ "--i": index + 1 } as CSSProperties}
            >
              {plan.featured ? <span className={styles.planBadge}>{copy.popular}</span> : null}
              <h3>{plan.name}</h3>
              <p className={styles.planNote}>{planCopy.note}</p>
              <p className={styles.planPrice}>
                <strong>{formatCzk(locale, price)}</strong> <span>{copy.perMonth}</span>
              </p>
              <p className={styles.planBilled}>
                {yearly ? copy.billedYearly(formatCzk(locale, periodPrice(plan.id, "yearly"))) : copy.noVat}
              </p>
              <ul>
                {planCopy.features.map((f) => (
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
                {copy.trial(TRIAL_DAYS)}
              </Link>
              <p className={styles.planTrial}>{copy.trialNote(TRIAL_INVOICE_LIMIT)}</p>
            </article>
          );
        })}

        <aside className={styles.planCustom} data-reveal="" style={{ "--i": PLANS.length + 1 } as CSSProperties}>
          <Headset className={styles.planCustomIcon} />
          <h3>{copy.customTitle}</h3>
          <p>{copy.customText}</p>
          <a href={contactHref} className={styles.textLink}>
            {copy.contact} <ArrowRight />
          </a>
        </aside>
      </div>
    </>
  );
}
