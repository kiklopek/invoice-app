"use client";

import { useCallback, useEffect, useState } from "react";
import { confirmAction } from "@/lib/confirm-action";
import { findPlan, formatCzk, monthlyPrice, PLANS, quote, TRIAL_DAYS, type BillingPeriod, type PlanId } from "@/lib/plans";
import styles from "./predplatne.module.css";

type Subscription = {
  status: string;
  state: "needs_payment" | "trial" | "active" | "past_due" | "expired";
  plan?: PlanId | null;
  period?: BillingPeriod | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
  trial_invoices_used?: number;
  trial_invoice_limit?: number | null;
  trial_denied_reason?: string | null;
  cancel_at_period_end?: boolean;
  scheduled_plan?: PlanId | null;
  scheduled_period?: BillingPeriod | null;
  scheduled_at?: string | null;
  has_card: boolean;
  managed_by_stripe: boolean;
};
type BillingResponse = { subscription: Subscription; can_manage: boolean; available: boolean; vat_payer: boolean };
type Preview = { kind: "upgrade" | "downgrade" | "trial"; dueNowHalere: number; nextChargeHalere: number; effectiveAt: string; prorationDate: number };
type Message = { tone: "ok" | "error" | "warn"; text: string } | null;

const date = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString("cs-CZ") : "—");
const periodLabel = (period: BillingPeriod | null | undefined) => (period === "yearly" ? "ročně" : "měsíčně");
const planLabel = (plan: PlanId | null | undefined, period: BillingPeriod | null | undefined) =>
  plan ? `${findPlan(plan)?.name ?? plan} ${periodLabel(period)}` : "bez tarifu";

async function post(action: string, extra: Record<string, unknown> = {}) {
  const response = await fetch("/api/billing/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
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

  const load = useCallback(async () => {
    const response = await fetch("/api/billing", { cache: "no-store" }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) as BillingResponse | null : null;
    if (!data) return setLoadError(true);
    setBilling(data);
    if (data.subscription.period) setPeriod(data.subscription.period);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(label: string, action: () => Promise<{ ok: boolean; data: Record<string, unknown> }>, success: string) {
    setBusy(label);
    setMessage(null);
    const { ok, data } = await action();
    setBusy(null);
    if (ok && typeof data.url === "string" && data.url) {
      window.location.assign(data.url);
      return;
    }
    if (ok && (data.status === "payment_required" || data.status === "requires_action")) {
      setMessage({ tone: "error", text: "Banka platbu nepotvrdila. Tarif zůstává beze změny; zkuste jinou kartu v Karta a faktury." });
    } else {
      setMessage(ok ? { tone: "ok", text: success } : { tone: "error", text: typeof data.error === "string" ? data.error : "Akce se nepodařila. Nic se nestrhlo." });
    }
    void load();
  }

  async function openSetup() {
    setBusy("setup");
    const response = await fetch("/api/billing/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: billing?.subscription.plan ?? "profi", period, from: "predplatne" }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { url?: string; error?: string } | null;
    setBusy(null);
    if (response?.ok && data?.url) window.location.assign(data.url);
    else setMessage({ tone: "error", text: data?.error ?? "Platební bránu se nepodařilo otevřít." });
  }

  async function startPaid(amount: number) {
    const confirmed = await confirmAction({
      title: `Strhnout ${formatCzk(amount)} z karty?`,
      description: "Předplatné se obnoví hned a další platby se strhnou automaticky na začátku každého období.",
      confirmLabel: `Zaplatit ${formatCzk(amount)}`,
      confirmVariant: "primary",
    });
    if (!confirmed) return void load();
    await run("start", () => post("start", { confirm: true }), "Předplatné je znovu aktivní.");
  }

  async function changeTo(plan: PlanId) {
    const target = { plan, period };
    setBusy(`preview-${plan}`);
    setMessage(null);
    const { ok, data } = await post("preview", target);
    setBusy(null);
    if (!ok) return setMessage({ tone: "error", text: typeof data.error === "string" ? data.error : "Změnu se nepodařilo spočítat." });
    const preview = data as unknown as Preview;
    const name = `${findPlan(plan)?.name} ${periodLabel(period)}`;
    const next = `${formatCzk(preview.nextChargeHalere)} za ${period === "yearly" ? "rok" : "měsíc"}`;
    const description = preview.kind === "trial"
      ? `Tarif se změní hned. Ve zkušební době nic neplatíte; po jejím konci se strhne ${next}.`
      : preview.kind === "upgrade"
        ? `Dnes strhneme ${formatCzk(preview.dueNowHalere)} (poměrná část do konce období po odečtení nevyčerpané části současného tarifu). Potom ${next}.`
        : `Změna platí od ${date(preview.effectiveAt)}. Do té doby zůstává současný tarif, peníze se nevrací. Potom ${next}.`;
    const confirmed = await confirmAction({
      title: preview.kind === "upgrade" ? `Přejít na ${name} a zaplatit ${formatCzk(preview.dueNowHalere)}?` : `Přejít na ${name}?`,
      description,
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
    const price = quote(sub.plan, sub.period);
    const amount = billing?.vat_payer ? price.grossHalere : price.netHalere;
    const confirmed = await confirmAction({
      title: `Ukončit zkušební dobu a zaplatit ${formatCzk(amount)}?`,
      description: `Tarif ${planLabel(sub.plan, sub.period)} začne hned a limit faktur zkušební doby zmizí. Další platba za ${sub.period === "yearly" ? "rok" : "měsíc"} automaticky.`,
      confirmLabel: `Zaplatit ${formatCzk(amount)}`,
      confirmVariant: "primary",
    });
    if (confirmed) await run("end_trial", () => post("end_trial", { confirm: true }), "Placený tarif začal.");
  }

  async function cancel() {
    const sub = billing?.subscription;
    const end = sub?.state === "trial" ? sub.trial_ends_at : sub?.current_period_end;
    const confirmed = await confirmAction({
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
    window.history.replaceState(null, "", window.location.pathname);
    if (outcome !== "hotovo" || !session) {
      setMessage({ tone: "warn", text: "Karta se neuložila a nic se nestrhlo." });
      return;
    }
    void (async () => {
      setBusy("activate");
      const response = await fetch("/api/billing/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { status?: string; dueNowHalere?: number; error?: string } | null;
      setBusy(null);
      if (data?.status === "trial_denied") {
        await startPaid(data.dueNowHalere ?? 0);
        return;
      }
      setMessage(response?.ok ? { tone: "ok", text: "Karta je uložená." } : { tone: "error", text: data?.error ?? "Kartu se nepodařilo ověřit." });
      void load();
    })();
    // startPaid a load jsou stabilní pro tento návrat z brány.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadError) return <div className={styles.page}><p className={styles.notice} data-tone="error">Předplatné se nepodařilo načíst. Obnovte prosím stránku.</p></div>;
  if (!billing) return <div className={styles.page}><p className="page-state">Načítám…</p></div>;

  const sub = billing.subscription;
  const manage = billing.can_manage && billing.available;
  const live = sub.managed_by_stripe && (sub.state === "trial" || sub.state === "active" || sub.state === "past_due");
  const used = sub.trial_invoices_used ?? 0;
  const limit = sub.trial_invoice_limit ?? 50;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1>Předplatné</h1>
        <p>Tarif, platby a faktury za Splatno. Vyšší tarif platí hned, nižší od dalšího období.</p>
      </header>

      {message ? <p className={styles.notice} data-tone={message.tone} role="status">{message.text}</p> : null}
      {!billing.available && billing.can_manage ? <p className={styles.notice}>Platby teď nejsou dostupné. Zkuste to prosím později.</p> : null}

      <section className={styles.section}>
        <div className={styles.status}>
          {sub.status === "legacy" || (!sub.managed_by_stripe && sub.state === "active") ? (
            <>
              <div className={styles.statusTop}><strong>Trvalý přístup</strong><span className={styles.badge}>Aktivní</span></div>
              <p className={styles.muted}>Vaše firma používá Splatno ze dřívější dohody. Nic nemusíte nastavovat.</p>
            </>
          ) : (
            <>
              <div className={styles.statusTop}>
                <strong>{planLabel(sub.plan, sub.period)}</strong>
                {sub.state === "trial" ? <span className={styles.badge}>Zkušební doba</span>
                  : sub.state === "active" ? <span className={styles.badge}>{sub.cancel_at_period_end ? "Ruší se" : "Aktivní"}</span>
                  : sub.state === "past_due" ? <span className={styles.badge} data-tone="error">Platba se nezdařila</span>
                  : sub.state === "needs_payment" ? <span className={styles.badge} data-tone="warn">Chybí karta</span>
                  : <span className={styles.badge} data-tone="error">Ukončené</span>}
              </div>
              <dl className={styles.facts}>
                {sub.state === "trial" ? (
                  <>
                    <div><dt>Zkušební doba do</dt><dd>{date(sub.trial_ends_at)}</dd></div>
                    <div><dt>Faktury ve zkušební době</dt><dd>{used} z {limit}</dd></div>
                  </>
                ) : null}
                {sub.state === "active" || sub.state === "past_due" ? (
                  <div><dt>{sub.cancel_at_period_end ? "Předplatné skončí" : "Další platba"}</dt><dd>{date(sub.current_period_end)}</dd></div>
                ) : null}
                {sub.plan && sub.period ? (
                  <div><dt>Cena</dt><dd>{formatCzk(quote(sub.plan, sub.period).netHalere)} bez DPH / {sub.period === "yearly" ? "rok" : "měsíc"}</dd></div>
                ) : null}
                {sub.scheduled_plan ? (
                  <div><dt>Od {date(sub.scheduled_at)}</dt><dd>{planLabel(sub.scheduled_plan, sub.scheduled_period)}</dd></div>
                ) : null}
              </dl>
              {sub.state === "trial" ? (
                <div className={styles.meter} data-full={used >= limit || undefined} aria-hidden="true"><span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} /></div>
              ) : null}
              {manage ? (
                <div className={styles.actions}>
                  {sub.state === "trial" ? <button type="button" className="btn primary" disabled={Boolean(busy)} onClick={() => void endTrial()}>Začít platit hned</button> : null}
                  {sub.scheduled_plan ? <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void run("cancel_change", () => post("cancel_change"), "Naplánovaná změna je zrušená.")}>Zrušit naplánovanou změnu</button> : null}
                  {sub.cancel_at_period_end ? <button type="button" className="btn primary" disabled={Boolean(busy)} onClick={() => void run("resume", () => post("resume"), "Předplatné pokračuje.")}>Pokračovat v předplatném</button> : null}
                  {sub.state === "needs_payment" || sub.state === "expired" ? (
                    <button type="button" className="btn primary" disabled={Boolean(busy)} onClick={() => void openSetup()}>{sub.state === "expired" ? "Obnovit předplatné" : "Zadat kartu"}</button>
                  ) : null}
                  {sub.has_card ? <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void run("portal", () => post("portal"), "")}>{sub.state === "past_due" ? "Aktualizovat kartu" : "Karta a faktury"}</button> : null}
                  {live && !sub.cancel_at_period_end ? <button type="button" className="btn ghost" disabled={Boolean(busy)} onClick={() => void cancel()}>Zrušit předplatné</button> : null}
                </div>
              ) : billing.can_manage ? null : <p className={styles.muted}>Předplatné spravuje administrátor firmy.</p>}
              {sub.state === "trial" ? <p className={styles.muted}>Zkušební doba trvá {TRIAL_DAYS} dní nebo do {limit}. faktury. Po ní se automaticky strhne zvolený tarif.</p> : null}
            </>
          )}
        </div>
      </section>

      {live && manage ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>Změnit tarif</h2>
            <div className={styles.toggle} role="radiogroup" aria-label="Období platby">
              {(["monthly", "yearly"] as const).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={period === value} data-on={period === value || undefined} onClick={() => setPeriod(value)}>
                  {value === "monthly" ? "Měsíčně" : <>Ročně<small>2 měsíce zdarma</small></>}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.plans}>
            {PLANS.map((plan) => {
              const current = sub.plan === plan.id && sub.period === period;
              return (
                <article key={plan.id} className={styles.plan} data-current={current || undefined}>
                  <h3>{plan.name}</h3>
                  <span className={styles.price}>{monthlyPrice(plan.id, period).toLocaleString("cs-CZ")} Kč <small>/ měsíc bez DPH</small></span>
                  <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                  {current
                    ? <span className={styles.badge}>Současný tarif</span>
                    : <button type="button" className="btn" disabled={Boolean(busy) || sub.state === "past_due"} onClick={() => void changeTo(plan.id)}>
                        {busy === `preview-${plan.id}` || busy === `change-${plan.id}` ? "Počítám…" : `Přejít na ${plan.name}`}
                      </button>}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
