"use client";

import { ExactMoney } from "@/components/money-amount";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmAction } from "@/lib/confirm-action";
import { findPlan, formatCzk, monthlyPrice, PLANS, quote, YEARLY_MONTHS_PAID, TRIAL_DAYS, type BillingPeriod, type PlanId } from "@/lib/plans";
import { AppFrame } from "@/components/layout/app-shell";
import { Icon } from "@/components/icons";
import { billingDate as date, billingMoney, type BillingResponse } from "@/lib/subscription-view";
import styles from "./predplatne.module.css";

const CARD_BRANDS: Record<string, string> = {
  visa: "visa", mastercard: "mastercard", amex: "amex",
  americanexpress: "amex", discover: "discover", diners: "diners",
  dinersclub: "diners", jcb: "jcb", unionpay: "unionpay",
};

function CardBrandIcon({ brand, compact = false }: { brand: string; compact?: boolean }) {
  const key = brand.toLowerCase().replace(/[\s_-]/g, "");
  const asset = Object.hasOwn(CARD_BRANDS, key) ? CARD_BRANDS[key] : undefined;
  return asset ? <Image src={`/payment-brands/${asset}.svg`} alt="" aria-hidden="true" width={40} height={26} className={compact ? styles.brandCompact : styles.brandLogo} /> : <Icon name="payment-card"/>;
}

type Preview = { kind: "upgrade" | "downgrade" | "trial"; dueNowHalere: number; nextChargeHalere: number; effectiveAt: string; prorationDate: number };
type Message = { tone: "ok" | "error" | "warn"; text: string } | null;

const periodLabel = (period: BillingPeriod | null | undefined) => (period === "yearly" ? "ročně" : "měsíčně");
const planLabel = (plan: PlanId | null | undefined, period: BillingPeriod | null | undefined) =>
  plan ? `${findPlan(plan)?.name ?? plan} ${periodLabel(period)}` : "bez tarifu";

async function post(action: string, extra: Record<string, unknown> = {}) {
  const response = await fetch("/api/billing/subscription", {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: { "content-type": "application/json", "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ action, ...extra }),
  }).catch(() => null);
  const data = await response?.json().catch(() => null) as Record<string, unknown> | null;
  return { ok: Boolean(response?.ok), data: data ?? {} };
}

// Stránka Předplatné: stav, změna tarifu (vyšší hned s doplatkem, nižší od
// dalšího období), karta a faktury ve Stripe, zrušení. Každá akce, která
// strhává peníze nebo mění tarif, se nejdřív potvrdí s částkou.
export function SubscriptionClient() {
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const inFlight = useRef(false);
  const confirming = useRef(false);
  const returnHandled = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [observedAt, setObservedAt] = useState(() => Date.now());
  const plansRef = useRef<HTMLElement>(null);

  async function ask(options: Parameters<typeof confirmAction>[0]) {
    if (confirming.current || inFlight.current) return false;
    confirming.current = true;
    try { return await confirmAction(options); } finally { confirming.current = false; }
  }

  const load = useCallback(async () => {
    const response = await fetch("/api/billing?details=1", { cache: "no-store", signal: AbortSignal.timeout(30000) }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) as BillingResponse | null : null;
    if (!data?.subscription || typeof data.subscription.state !== "string" || typeof data.can_manage !== "boolean") return setLoadError(true);
    setLoadError(false);
    setObservedAt(Date.now());
    setBilling(data);
    if (data.subscription.period) setPeriod(data.subscription.period);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(label: string, action: () => Promise<{ ok: boolean; data: Record<string, unknown> }>, success: string) {
    if (inFlight.current || confirming.current) return;
    inFlight.current = true;
    setBusy(label);
    setMessage(null);
    let result: Awaited<ReturnType<typeof post>>;
    try { result = await action(); } catch { result = { ok: false, data: {} }; }
    const { ok, data } = result;
    inFlight.current = false;
    setBusy(null);
    if (ok && typeof data.url === "string" && data.url) {
      window.location.assign(data.url);
      return;
    }
    if (ok && (data.status === "payment_required" || data.status === "requires_action")) {
      setMessage({ tone: "error", text: "Banka platbu nepotvrdila. Tarif zůstává beze změny; zkuste jinou kartu v Karta a faktury." });
    } else {
      const verified = ok && ["changed", "scheduled", "subscribed"].includes(String(data.status));
      const pending = data.status === "subscribed" && data.subscriptionStatus && !["active", "trialing"].includes(String(data.subscriptionStatus));
      setMessage(pending ? { tone: "warn", text: "Předplatné ještě není aktivní. Ověřte aktuální údaje platební brány." } : verified ? { tone: "ok", text: success } : { tone: "error", text: typeof data.error === "string" ? data.error : "Akci se nepodařilo ověřit. Obnovte údaje před dalším pokusem." });
    }
    void load();
  }

  async function openSetup(plan = billing?.subscription.plan ?? "profi") {
    if (inFlight.current || confirming.current) return;
    inFlight.current = true;
    setBusy("setup");
    const response = await fetch("/api/billing/setup", {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan, period, from: "predplatne" }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { url?: string; error?: string } | null;
    inFlight.current = false;
    setBusy(null);
    if (response?.ok && data?.url) window.location.assign(data.url);
    else setMessage({ tone: "error", text: data?.error ?? "Platební bránu se nepodařilo otevřít." });
  }

  async function startPaid(amount: number) {
    const confirmed = await ask({
      title: `Strhnout ${formatCzk(amount)} z karty?`,
      description: "Předplatné se obnoví hned a další platby se strhnou automaticky na začátku každého období.",
      confirmLabel: `Zaplatit ${formatCzk(amount)}`,
      confirmVariant: "primary",
    });
    if (!confirmed) return void load();
    await run("start", () => post("start", { confirm: true }), "Předplatné je znovu aktivní.");
  }

  async function changeTo(plan: PlanId) {
    if (inFlight.current || confirming.current) return;
    if (!billing?.subscription.managed_by_stripe || ["needs_payment", "expired"].includes(billing.subscription.state)) {
      if (await ask({ title: `Zvolit ${findPlan(plan)?.name} ${periodLabel(period)}?`, description: `Pokračujete do zabezpečené platební brány. Cenu a podmínky potvrdíte před aktivací.`, confirmLabel: "Pokračovat", confirmVariant: "primary" })) await openSetup(plan);
      return;
    }
    inFlight.current = true;
    const target = { plan, period };
    setBusy(`preview-${plan}`);
    setMessage(null);
    const { ok, data } = await post("preview", target);
    inFlight.current = false;
    setBusy(null);
    if (!ok) return setMessage({ tone: "error", text: typeof data.error === "string" ? data.error : "Změnu se nepodařilo spočítat." });
    const preview = data as unknown as Preview;
    if (!["upgrade", "downgrade", "trial"].includes(preview.kind) || !Number.isFinite(preview.dueNowHalere) || preview.dueNowHalere < 0 || !Number.isFinite(preview.nextChargeHalere) || !Number.isFinite(preview.prorationDate) || Number.isNaN(Date.parse(preview.effectiveAt))) {
      setMessage({ tone: "error", text: "Platební brána nevrátila platný náhled změny. Zkuste to prosím znovu." });
      return;
    }
    const name = `${findPlan(plan)?.name} ${periodLabel(period)}`;
    const next = `${formatCzk(preview.nextChargeHalere)} za ${period === "yearly" ? "rok" : "měsíc"}`;
    const description = preview.kind === "trial"
      ? `Tarif se změní hned. Ve zkušební době nic neplatíte; po jejím konci se strhne ${next}.`
      : preview.kind === "upgrade"
        ? `Dnes strhneme ${formatCzk(preview.dueNowHalere)} (poměrná část do konce období po odečtení nevyčerpané části současného tarifu). Odhad pravidelné platby: ${next}.`
        : `Změna platí od ${date(preview.effectiveAt)}. Do té doby zůstává současný tarif, peníze se nevrací. Odhad pravidelné platby: ${next}.`;
    const confirmed = await ask({
      title: preview.kind === "upgrade" ? `Přejít na ${name} a zaplatit ${formatCzk(preview.dueNowHalere)}?` : `Přejít na ${name}?`,
      description: `Současný tarif: ${planLabel(billing?.subscription.plan, billing?.subscription.period)}.${billing?.details?.pricing?.amount != null ? ` Základní cena ${billingMoney(billing.details.pricing.amount, billing.details.pricing.currency)} před slevami a daní.` : ""} ${description}`,
      confirmLabel: preview.kind === "upgrade" ? `Zaplatit ${formatCzk(preview.dueNowHalere)}` : "Změnit tarif",
      confirmVariant: "primary",
    });
    if (!confirmed) return;
    await run(`change-${plan}`, () => post("change", { ...target, proration_date: preview.prorationDate, confirm: true }),
      preview.kind === "downgrade" ? `Od ${date(preview.effectiveAt)} přejdete na ${name}.` : `Tarif je změněný na ${name}.`);
  }

  async function endTrial() {
    const sub = billing?.subscription;
    if (!sub?.plan || !sub.period) return;
    if (inFlight.current || confirming.current) return;
    inFlight.current = true; setBusy("preview_end_trial");
    const preview = await post("preview_end_trial");
    inFlight.current = false; setBusy(null);
    if (!preview.ok || typeof preview.data.dueNowHalere !== "number" || typeof preview.data.currency !== "string") {
      setMessage({ tone: "error", text: "Aktuální částku se nepodařilo ověřit. Zkuste to znovu." });
      return;
    }
    const amount = billingMoney(preview.data.dueNowHalere, preview.data.currency);
    const confirmed = await ask({
      title: `Ukončit zkušební dobu a zaplatit ${amount}?`,
      description: `Tarif ${planLabel(sub.plan, sub.period)} začne hned a uplatní se jeho měsíční limit faktur. Další platba za ${sub.period === "yearly" ? "rok" : "měsíc"} automaticky.`,
      confirmLabel: `Zaplatit ${amount}`,
      confirmVariant: "primary",
    });
    if (confirmed) await run("end_trial", () => post("end_trial", { confirm: true }), "Placený tarif začal.");
  }

  async function cancel() {
    const sub = billing?.subscription;
    const end = sub?.state === "trial" ? sub.trial_ends_at : sub?.current_period_end;
    const confirmed = await ask({
      title: "Zrušit předplatné?",
      description: `Splatno funguje do ${date(end)}. Potom se nové faktury a automatické upomínky zastaví; data zůstanou. Rozmyslet si to můžete do té doby.`,
      confirmLabel: "Zrušit předplatné",
    });
    if (confirmed) await run("cancel", () => post("cancel", { confirm: true }), `Předplatné skončí ${date(end)}.`);
  }

  // Návrat z uložení karty (obnovení předplatného po zrušení).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("platba");
    const session = params.get("session");
    if (!outcome) return;
    if (returnHandled.current) return;
    returnHandled.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    if (outcome !== "hotovo" || !session) {
      setMessage({ tone: "warn", text: "Karta se neuložila a nic se nestrhlo." });
      return;
    }
    void (async () => {
      setBusy("activate");
      const response = await fetch("/api/billing/activate", {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { status?: string; dueNowHalere?: number; error?: string } | null;
      setBusy(null);
      if (data?.status === "trial_denied") {
        await startPaid(data.dueNowHalere ?? 0);
        return;
      }
      setMessage(response?.ok && data?.status === "subscribed" ? { tone: "ok", text: "Karta je uložená." } : data?.status === "pending" ? { tone: "warn", text: "Platební brána ještě nepotvrdila dokončení. Obnovte údaje za chvíli." } : { tone: "error", text: data?.error ?? "Kartu se nepodařilo ověřit." });
      void load();
    })();
    // startPaid a load jsou stabilní pro tento návrat z brány.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sub = billing?.subscription;
  const manage = Boolean(billing?.can_manage && billing.available && !sub?.billing_exempt);
  const live = Boolean(sub?.managed_by_stripe && ["trial", "active", "past_due"].includes(sub.state));
  const providerRecovery = Boolean(sub?.managed_by_stripe && ["incomplete", "unpaid", "paused"].includes(sub.status));
  const currentPlan = findPlan(sub?.plan);
  const individual = Boolean(sub?.managed_by_stripe && !currentPlan && !["needs_payment", "expired"].includes(sub.state));
  const details = billing?.details;
  const price = details?.pricing;
  const intervalUnit = ({ year: "rok", month: "měsíc", week: "týden", day: "den" } as Record<string, string>)[price?.interval ?? ""] ?? "období";
  const actualInterval = (price?.intervalCount ?? 1) > 1 ? `${price?.intervalCount} × ${intervalUnit}` : intervalUnit;
  const disabled = Boolean(busy);
  const stateLabel = sub?.billing_exempt ? "Aktivní" : sub?.cancel_at_period_end ? "Naplánované ukončení" : sub?.status === "paused" ? "Pozastaveno" : sub?.status === "incomplete" || sub?.status === "incomplete_expired" ? "Aktivace nedokončena" : ({ trial: "Zkušební období", active: "Aktivní", past_due: "Problém s platbou", needs_payment: "Bez předplatného", expired: "Ukončeno" }[sub?.state ?? "needs_payment"]);
  const daysLeft = sub?.trial_ends_at ? Math.max(0, Math.ceil((Date.parse(sub.trial_ends_at) - observedAt) / 86400000)) : 0;
  const portal = () => void run("portal", () => post("portal"), "");
  const goToPlans = () => { plansRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); plansRef.current?.focus({ preventScroll: true }); };

  return <AppFrame className={`content section-page ${styles.frame}`}>
    <div className={styles.page} data-subscription aria-busy={Boolean(busy)}>
      <header className={styles.head}><h1>Předplatné</h1><p>Spravujte své předplatné, limity a platební údaje.</p></header>
      {loadError ? <section className={styles.section} role="alert"><h2>Nepodařilo se načíst informace o předplatném.</h2><button type="button" className="btn secondary" onClick={() => void load()}>Zkusit znovu</button></section> : !billing || !sub ? <div className={styles.skeleton} aria-label="Načítání předplatného" role="status"><div/><div/><div/></div> : <>
        {message && <p className={styles.notice} data-tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>}
        {!billing.available && billing.can_manage && !sub.billing_exempt && <p className={styles.notice}>Platební brána není dostupná. Údaje obnovíte tlačítkem níže. <button type="button" onClick={() => void load()}>Zkusit znovu</button></p>}
        {sub.state === "past_due" && <p className={styles.notice} data-tone="error" role="alert">Nepodařilo se zpracovat poslední platbu. {manage && <button type="button" disabled={disabled} onClick={portal}>Opravit platební údaje</button>}</p>}
        {details?.error && <p className={styles.notice}>Některé údaje platební brány se nepodařilo načíst. <button type="button" disabled={disabled} onClick={() => void load()}>Zkusit znovu</button></p>}
        <section className={styles.current} aria-label="Aktuální předplatné">
          <div className={styles.planSummary}><span className={styles.planIcon}><Icon name="document"/></span><div><span className={styles.eyebrow}>Aktuální plán</span><div className={styles.statusTop}><h2>{sub.billing_exempt ? "Trvalý přístup" : currentPlan?.name ?? (individual ? "Individuální tarif" : "Bez aktivního tarifu")}</h2><span className={styles.badge} data-tone={sub.state === "past_due" || sub.state === "expired" ? "error" : undefined}>{stateLabel}</span></div>
            <p>{sub.billing_exempt ? "Vaše firma má trvalý přístup bez platby. Kartu ani tarif není potřeba nastavovat." : currentPlan?.note ?? (individual ? "Individuální podmínky vašeho předplatného spravuje platební brána." : "Zatím nemáte aktivní předplatné. Vyberte si z dostupných plánů.")}</p>
            {currentPlan && !sub.billing_exempt && <ul className={styles.features}>{currentPlan.features.map(feature => <li key={feature}><Icon name="tick"/>{feature}</li>)}</ul>}
            {sub.state === "trial" && <p className={styles.trial}>Zbývá {daysLeft} dní · do {date(sub.trial_ends_at)}. Zkušební období trvá nejvýše {TRIAL_DAYS} dní nebo {sub.trial_invoice_limit ?? "—"} faktur.</p>}
          </div></div>
          <div className={styles.billingSummary}><span className={styles.eyebrow}>{price?.nextAmount != null ? "Příští vyúčtování (odhad)" : "Cena za období"}</span>
            <p className={styles.currentPrice}>{sub.billing_exempt ? "Bez platby" : price && (price.nextAmount ?? price.amount) != null ? <><ExactMoney value={(price.nextAmount ?? price.amount)! / 100} currency={price.currency.toUpperCase()} /> <small>/ {actualInterval}</small></> : "Dle vyúčtování"}</p>
            {price?.nextAmount == null && price?.amount != null && <small>Základní cena před slevami a daní.</small>}
            {sub.cancel_at_period_end ? <p>Přístup do {date(sub.state === "trial" ? sub.trial_ends_at : sub.current_period_end)}</p> : sub.current_period_end ? <p>Další platba: {date(sub.current_period_end)}</p> : null}
            {sub.scheduled_plan && <p>Od {date(sub.scheduled_at)}: {planLabel(sub.scheduled_plan, sub.scheduled_period)}</p>}
            {billing.can_manage && sub.has_card && !sub.billing_exempt && <button type="button" className={styles.textButton} disabled={!manage || disabled} onClick={() => document.getElementById("subscription-history")?.scrollIntoView({ behavior: "smooth" })}>Zobrazit faktury a historii <span aria-hidden="true">→</span></button>}
          </div>
          <div className={styles.management}>
            {!sub.billing_exempt && <div className={styles.manageTop}><button type="button" className="btn secondary" disabled={!manage || disabled || providerRecovery || individual} onClick={goToPlans}>Změnit plán</button>{manage && <details className={styles.context} open={menuOpen} onToggle={event => setMenuOpen(event.currentTarget.open)}><summary aria-label="Možnosti předplatného"><Icon name="more"/></summary><div data-popup>
              {sub.has_card && <button type="button" disabled={disabled} onClick={portal}>Spravovat předplatné</button>}
              {sub.scheduled_plan && <button type="button" disabled={disabled} onClick={() => void run("cancel_change", () => post("cancel_change"), "Naplánovaná změna je zrušená.")}>Zrušit naplánovanou změnu</button>}
              {sub.cancel_at_period_end ? <button type="button" disabled={disabled} onClick={() => void run("resume", () => post("resume"), "Předplatné pokračuje.")}>Obnovit automatické obnovení</button> : live && <button type="button" disabled={disabled} onClick={() => void cancel()}>Zrušit předplatné</button>}
            </div></details>}</div>}
            {details?.card && <p className={styles.cardSummary}><CardBrandIcon brand={details.card.brand} compact/>{details.card.brand} •••• {details.card.last4}</p>}
            {manage && sub.has_card && <button type="button" className={styles.textButton} disabled={disabled} onClick={portal}>Spravovat platební metodu →</button>}
            {manage && (sub.state === "needs_payment" || sub.state === "expired") && <button type="button" className="btn primary" disabled={disabled} onClick={providerRecovery ? portal : () => void openSetup()}>{providerRecovery ? "Vyřešit předplatné ve Stripe" : sub.state === "expired" ? "Obnovit předplatné" : "Zadat kartu"}</button>}
            {manage && sub.state === "trial" && <button type="button" className={styles.textButton} disabled={disabled} onClick={() => void endTrial()}>Začít platit hned</button>}
            {!billing.can_manage && <p>Předplatné spravuje administrátor firmy.</p>}
          </div>
        </section>
        {!sub.billing_exempt && <section ref={plansRef} tabIndex={-1} className={styles.available} aria-labelledby="available-plans">
          <div className={styles.sectionHead}><div><h2 id="available-plans">Dostupné plány</h2><p>Vyberte si plán, který nejlépe odpovídá vašim potřebám.</p></div><div className={styles.toggle} role="group" aria-label="Období platby">{(["monthly", "yearly"] as const).map(value => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{value === "monthly" ? "Měsíčně" : <>Ročně <small>{12 - YEARLY_MONTHS_PAID} měsíce zdarma</small></>}</button>)}</div></div>
          <div className={styles.plans}>{PLANS.map(plan => { const current = sub.plan === plan.id && sub.period === period; return <article className={styles.plan} key={plan.id} data-current={current || undefined}><div className={styles.planTitle}><h3>{plan.name}</h3>{current && <span className={styles.badge}>Aktuální</span>}</div><p>{plan.note}</p><div className={styles.price}>{monthlyPrice(plan.id, period).toLocaleString("cs-CZ")} Kč <small>/ měsíc bez DPH</small></div>{period === "yearly" && <p>Roční platba {formatCzk(quote(plan.id, period).netHalere)} bez DPH.</p>}<ul className={styles.features}>{plan.features.map(feature => <li key={feature}><Icon name="tick"/>{feature}</li>)}</ul><button type="button" className={current ? "btn secondary" : "btn primary"} disabled={current || !manage || disabled || sub.state === "past_due" || providerRecovery || individual} onClick={() => void changeTo(plan.id)}>{current ? "Aktuální plán" : busy?.endsWith(plan.id) ? "Počítám…" : "Zvolit plán"}</button></article>; })}</div>
        </section>}
        <div className={styles.bottom}>
          <section className={styles.section} aria-labelledby="usage-title"><div className={styles.sectionHead}><h2 id="usage-title">Využití a limity</h2><span className={styles.eyebrow}>{billing.usage ? new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(billing.usage.month)) : "Aktuální období"}</span></div><div className={styles.metrics}>{billing.usage?.metrics.map(metric => <div className={styles.metric} key={metric.key}><span>{metric.label}<small>{metric.period === "trial" ? "Zkušební období" : metric.period === "month" ? "Uloženo tento měsíc" : "Celkem"}</small></span>{metric.limit != null && metric.used != null ? <progress value={Math.min(metric.used, metric.limit)} max={metric.limit} aria-label={`${metric.label}: ${metric.used} z ${metric.limit}`}/> : <span className={styles.noLimit}>{metric.used == null ? "Nelze načíst" : metric.key === "invoices" ? "Neomezeně" : "Bez tarifního limitu"}</span>}<strong>{metric.used == null ? "—" : `${metric.used}${metric.limit != null ? ` / ${metric.limit}` : ""}`}</strong>{metric.limit != null && metric.used != null && metric.used >= metric.limit * .9 && <small className={styles.limitNotice}>{metric.used >= metric.limit ? "Limit je dosažený." : "Blížíte se k limitu."}</small>}</div>) ?? <p className={styles.muted}>Údaje o využití nejsou dostupné.</p>}</div></section>
          <section className={styles.section} aria-labelledby="payment-method-title"><h2 id="payment-method-title">Platební metoda</h2>{sub.billing_exempt ? <p className={styles.muted}>Pro trvalý přístup není platební metoda potřeba.</p> : !billing.can_manage ? <p className={styles.muted}>Platební údaje jsou dostupné administrátorovi firmy.</p> : details?.card ? <div className={styles.paymentCard}><CardBrandIcon brand={details.card.brand}/><div><strong>{details.card.brand}</strong><span>•••• •••• •••• {details.card.last4}</span></div><small>{details.card.expired ? "Karta je po platnosti" : "Platná do"} {details.card.expMonth}/{details.card.expYear}</small></div> : <p className={styles.muted}>{!details || details.error ? "Platební metodu se nepodařilo načíst." : details?.paymentType ? "Platební metoda je spravovaná ve Stripe." : "Nemáte uloženou platební kartu."}</p>}{manage && <button type="button" className="btn secondary" disabled={disabled} onClick={sub.has_card ? portal : () => void openSetup()}>{sub.has_card ? "Změnit platební metodu" : "Přidat platební metodu"}</button>}</section>
        </div>
        {billing.can_manage && !sub.billing_exempt && <section className={styles.section} id="subscription-history" aria-labelledby="billing-history-title"><div className={styles.sectionHead}><h2 id="billing-history-title">Faktury a historie</h2>{manage && sub.has_card && <button type="button" className={styles.textButton} disabled={disabled} onClick={portal}>Všechny doklady ve Stripe →</button>}</div>{details?.history.length ? <div className={styles.history}>{details.history.map(invoice => <div className={styles.historyRow} key={invoice.id}><time>{date(invoice.created)}</time><strong>{invoice.number ?? "Předplatné Splatno"}</strong><span><ExactMoney value={invoice.amount / 100} currency={invoice.currency.toUpperCase()} /></span><span className={styles.badge}>{({ paid: "Zaplaceno", open: "K úhradě", draft: "Koncept", void: "Stornováno", uncollectible: "Neuhrazeno" } as Record<string, string>)[invoice.status ?? ""] ?? "Stav neuveden"}</span>{invoice.pdf ? <a href={invoice.pdf} target="_blank" rel="noopener noreferrer">Stáhnout PDF</a> : invoice.url ? <a href={invoice.url} target="_blank" rel="noopener noreferrer">Otevřít doklad</a> : <span>Doklad není dostupný</span>}</div>)}</div> : <p className={styles.muted}>{!details || details.error ? "Historii se nepodařilo načíst." : "Zatím nemáte žádné fakturační doklady."}</p>}</section>}
      </>}
    </div>
  </AppFrame>;
}
