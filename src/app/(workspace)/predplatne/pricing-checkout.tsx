"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { confirmAction } from "@/lib/confirm-action";
import { findPlan, formatCzk, isBillingPeriod, monthlyPrice, PLANS, quote, type BillingPeriod, type PlanId } from "@/lib/plans";
import styles from "./predplatne.module.css";

type BillingData = {
  subscription: { state: "trial" | "active" | "expired"; status: string; plan: string | null; period: string | null; trial_ends_at: string | null; current_period_end: string | null; warning: { kind: string; daysLeft: number } | null };
  orders: { id: string; order_number: string; plan: string; period: string; gross_halere: number; payment_method: string; status: string; invoice_number: string | null; created_at: string }[];
  verified: boolean;
  can_order: boolean;
  methods: { card: boolean; transfer: boolean };
  vat_payer: boolean;
  billing_defaults: { name: string; ico: string; dic: string; address: string; email: string } | null;
};

const date = (value: string | null) => (value ? new Date(value).toLocaleDateString("cs-CZ") : "");
const periodName = (period: string | null) => (period === "yearly" ? "ročně" : "měsíčně");

// Stránka Koupit: výběr tarifu, fakturační údaje, způsob platby a shrnutí.
// Částku zobrazuje z plans.ts jen pro informaci; účtuje ji vždy server.
export function PricingCheckout({ initialPlan, initialPeriod }: { initialPlan: string | null; initialPeriod: string | null }) {
  const { data, error } = useSWR<BillingData>("/api/billing");
  const [plan, setPlan] = useState<PlanId>((findPlan(initialPlan)?.id ?? "profi") as PlanId);
  const [period, setPeriod] = useState<BillingPeriod>(isBillingPeriod(initialPeriod) ? initialPeriod : "yearly");
  const [method, setMethod] = useState<"card" | "transfer">("card");
  const [billing, setBilling] = useState({ name: "", ico: "", dic: "", address: "", email: "" });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (data?.billing_defaults) setBilling((current) => (current.name ? current : data.billing_defaults!));
    if (data && !data.methods.card && data.methods.transfer) setMethod("transfer");
  }, [data]);

  const price = useMemo(() => {
    const value = quote(plan, period);
    return data && !data.vat_payer ? { ...value, vatHalere: 0, grossHalere: value.netHalere } : value;
  }, [plan, period, data]);

  async function order() {
    setMessage(null);
    const selected = findPlan(plan)!;
    const ok = await confirmAction({
      title: `Objednat ${selected.name} ${periodName(period)}?`,
      description: `Celkem ${formatCzk(price.grossHalere)}${price.vatHalere ? " včetně DPH" : ""}. ${method === "card" ? "Budete přesměrováni na platební bránu Comgate." : "Na e-mail " + billing.email + " pošleme výzvu k platbě s QR kódem."}`,
      confirmLabel: method === "card" ? "Objednat a zaplatit" : "Objednat",
      confirmVariant: "primary",
    });
    if (!ok) return;
    setSubmitting(true);
    const response = await fetch("/api/billing/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan, period, method, billing }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null) as { redirect?: string; error?: string } | null;
    if (response?.ok && body?.redirect) {
      window.location.assign(body.redirect);
      return;
    }
    setMessage(body?.error ?? "Objednávku se nepodařilo odeslat. Zkuste to prosím znovu.");
    setSubmitting(false);
  }

  if (error) return <p className="page-state error-state">Předplatné se nepodařilo načíst.</p>;
  if (!data) return <p className="page-state">Načítám předplatné…</p>;
  const sub = data.subscription;
  const current = findPlan(sub.plan);
  const unavailable = !data.methods.card && !data.methods.transfer;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1>Předplatné</h1>
        <p>
          {sub.state === "trial" && `Zkušební doba do ${date(sub.trial_ends_at)}${sub.warning ? ` (zbývá ${sub.warning.daysLeft} ${sub.warning.daysLeft === 1 ? "den" : sub.warning.daysLeft < 5 ? "dny" : "dní"})` : ""}.`}
          {sub.state === "active" && (current ? `Aktivní tarif ${current.name}, platba ${periodName(sub.period)}${sub.current_period_end ? `, zaplaceno do ${date(sub.current_period_end)}` : ""}.` : "Předplatné je aktivní.")}
          {sub.state === "expired" && "Zkušební doba nebo předplatné skončilo. Data zůstávají, ale nové faktury a automatické upomínky jsou pozastavené."}
        </p>
      </header>

      {!data.verified ? (
        <p className={styles.notice}>Před nákupem je potřeba ověřit firmu přes datovou schránku. <Link href="/settings">Ověřit v Nastavení → Firma</Link></p>
      ) : null}
      {!data.can_order ? <p className={styles.notice}>Tarif může koupit administrátor firmy.</p> : null}
      {unavailable ? <p className={styles.notice}>Nákup teď není dostupný. Zkuste to prosím později.</p> : null}

      <section className={styles.section} aria-label="Tarif">
        <div className={styles.sectionHead}>
          <h2>1. Tarif</h2>
          <div className={styles.toggle} role="radiogroup" aria-label="Období platby">
            {(["monthly", "yearly"] as const).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={period === value} data-on={period === value || undefined} onClick={() => setPeriod(value)}>
                {value === "monthly" ? "Měsíčně" : "Ročně −20 %"}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.plans} role="radiogroup" aria-label="Tarif">
          {PLANS.map((item) => (
            <button key={item.id} type="button" role="radio" aria-checked={plan === item.id} className={styles.plan} data-on={plan === item.id || undefined} onClick={() => setPlan(item.id)}>
              <strong>{item.name}</strong>
              <span className={styles.price}>{monthlyPrice(item.id, period).toLocaleString("cs-CZ")} Kč <small>/ měsíc bez DPH</small></span>
              <small>{item.note}</small>
              <ul>{item.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-label="Fakturační údaje">
        <h2>2. Fakturační údaje</h2>
        <div className={styles.grid}>
          {([["name", "Název firmy"], ["ico", "IČO"], ["dic", "DIČ (nepovinné)"], ["address", "Sídlo"], ["email", "E-mail pro faktury"]] as const).map(([key, label]) => (
            <label key={key} className={styles.field}>
              <span>{label}</span>
              <input value={billing[key]} type={key === "email" ? "email" : "text"} onChange={(event) => setBilling((current) => ({ ...current, [key]: event.target.value }))} />
            </label>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-label="Způsob platby">
        <h2>3. Způsob platby</h2>
        <div className={styles.methods}>
          <label className={styles.method} data-disabled={!data.methods.card || undefined}>
            <input type="radio" name="method" checked={method === "card"} disabled={!data.methods.card} onChange={() => setMethod("card")} />
            <span><b>Kartou nebo bankovním tlačítkem</b><small>Comgate · karta, Apple Pay, Google Pay, rychlý převod. Tarif se aktivuje hned po zaplacení.</small></span>
          </label>
          <label className={styles.method} data-disabled={!data.methods.transfer || undefined}>
            <input type="radio" name="method" checked={method === "transfer"} disabled={!data.methods.transfer} onChange={() => setMethod("transfer")} />
            <span><b>Převodem podle faktury</b><small>Pošleme výzvu k platbě s QR kódem, splatnost 7 dní. Tarif se aktivuje po připsání platby.</small></span>
          </label>
        </div>
      </section>

      <section className={styles.summary} aria-label="Shrnutí">
        <h2>4. Shrnutí</h2>
        <dl>
          <div><dt>{findPlan(plan)?.name} · {price.months === 12 ? "12 měsíců" : "1 měsíc"}</dt><dd>{formatCzk(price.netHalere)}</dd></div>
          {price.vatHalere ? <div><dt>DPH 21 %</dt><dd>{formatCzk(price.vatHalere)}</dd></div> : null}
          <div className={styles.total}><dt>Celkem</dt><dd>{formatCzk(price.grossHalere)}</dd></div>
        </dl>
        {message ? <p className="form-error">{message}</p> : null}
        <button type="button" className="btn primary" disabled={submitting || !data.verified || !data.can_order || unavailable} onClick={() => void order()}>
          {submitting ? "Odesílám…" : method === "card" ? "Objednat a zaplatit" : "Objednat"}
        </button>
      </section>

      {data.orders.length ? (
        <section className={styles.section} aria-label="Objednávky">
          <h2>Objednávky a faktury</h2>
          <table className={styles.orders}>
            <thead><tr><th>Objednávka</th><th>Tarif</th><th>Částka</th><th>Stav</th><th>Doklad</th></tr></thead>
            <tbody>
              {data.orders.map((item) => (
                <tr key={item.id}>
                  <td>{item.order_number}<br /><small>{date(item.created_at)}</small></td>
                  <td>{findPlan(item.plan)?.name} {periodName(item.period)}</td>
                  <td>{formatCzk(item.gross_halere)}</td>
                  <td>{item.status === "paid" ? "Zaplaceno" : item.status === "cancelled" ? "Zrušeno" : "Čeká na platbu"}</td>
                  <td><a href={`/api/billing/orders/${item.id}/pdf`}>{item.invoice_number ? `Faktura ${item.invoice_number}` : "Výzva k platbě"}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
