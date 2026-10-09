"use client";

import Image from "next/image";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bank, Bell, Check, FileText, Home, Mail, Shield, Users } from "@/components/landing/landing-icons";
import { findPlan, formatCzk, isBillingPeriod, monthlyPrice, PLANS, quote, TRIAL_DAYS, TRIAL_INVOICE_LIMIT, type BillingPeriod, type PlanId } from "@/lib/plans";
import { RibbonMark } from "@/components/landing/landing-icons";
import { isValidBankAccount, isValidIco } from "@/lib/company-validation";
import { confirmAction } from "@/lib/confirm-action";
import { isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { normalizeOnboardingCompany, validateOnboardingCompany, type OnboardingCompany } from "@/lib/onboarding";
import { roleNames, type AccessRole } from "@/lib/role-access";
import { defaultReminderTemplates } from "@/lib/reminder-defaults";
import { MAX_REMINDER_CC_RECIPIENTS, parseReminderCcInput } from "@/lib/reminder-recipients";
import { detectLogoType, MAX_LOGO_BYTES } from "@/lib/company-logo-file";
import styles from "./onboarding.module.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap" });

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type Reminders = { days: number[]; replyTo: string; ccText: string };
type PaymentState = "idle" | "redirecting" | "activating" | "denied" | "starting" | "done";
type Denied = { reason: string; dueNowHalere: number; plan: PlanId; period: BillingPeriod };
export type PaymentContext = { companyName: string; canManage: boolean; plan: string | null; period: string | null };

const PLAN_CHOICE_KEY = "splatno:plan-choice";
const DENIED_REASON: Record<string, string> = {
  ico_used: "Firma s tímto IČO už zkušební dobu ve Splatnu využila.",
  card_used: "Tato karta už byla použita pro zkušební dobu jiné firmy.",
  ip_limit: "Z této sítě se v posledních 30 dnech spustilo víc zkušebních dob, než povolujeme.",
  restart: "Předplatné obnovujete, zkušební doba se znovu nepočítá.",
};

const REMINDER_STAGES = ["before_due", "on_due", "overdue", "escalation"] as const;
const DAY_OPTIONS = [-7, -3, -1, 0, 3, 7, 14, 30];
const DEFAULT_REMINDERS: Reminders = { days: [-3, 0, 7, 14], replyTo: "", ccText: "" };

function dayLabel(day: number) {
  if (day === 0) return "V den splatnosti";
  return day < 0 ? `${-day} ${-day === 1 ? "den" : "dny"} před` : `${day} ${day < 5 ? "dny" : "dní"} po`;
}
type Invite = { email: string; role: AccessRole };
type AresState = "idle" | "loading" | "found" | "not_found" | "unavailable";

const STEPS: { title: string; sub: string }[] = [
  { title: "Vaše firma", sub: "IČO a základní údaje" },
  { title: "Kontakt", sub: "Kam vám psát" },
  { title: "Bankovní účet", sub: "Kam vám chodí platby" },
  { title: "Upomínky", sub: "Kdy zákazníkům připomenout" },
  { title: "Logo", sub: "Vzhled faktur a e-mailů" },
  { title: "Tým", sub: "Pozvěte kolegy" },
  { title: "Shrnutí", sub: "Kontrola a založení" },
  { title: "Tarif a karta", sub: `${TRIAL_DAYS} dní zdarma` },
];

const ART: Record<Step, { src: string; title: string; sub: string }> = {
  1: { src: "/brand/mascot/wave.webp", title: "Vítejte ve Splatnu.", sub: "Podle IČO doplníme údaje z obchodního rejstříku." },
  2: { src: "/brand/mascot/phone.webp", title: "Odpovědi vám přijdou sem.", sub: "Z tohoto e-mailu uvidí zákazníci faktury a upomínky." },
  3: { src: "/brand/mascot/laptop.webp", title: "Platby spárujeme za vás.", sub: "Číslo účtu ověříme kontrolní číslicí, ať se nepáruje na překlep." },
  4: { src: "/brand/mascot/phone.webp", title: "Ať vám nic neuteče.", sub: "Nic se neodešle bez vás: automat zapnete sami, až uvidíte, komu co půjde." },
  5: { src: "/brand/mascot/wave.webp", title: "Vaše firma, váš vzhled.", sub: "Logo uvidí zákazníci v upomínkách a kolegové v aplikaci." },
  6: { src: "/brand/mascot/wave.webp", title: "Společně to zvládneme.", sub: "Kolegy pozvete teď, nebo kdykoli později v Nastavení." },
  7: { src: "/brand/mascot/laptop.webp", title: "Faktury pod kontrolou.", sub: "Firma vznikne až posledním tlačítkem." },
  8: { src: "/brand/mascot/phone.webp", title: `${TRIAL_DAYS} dní zdarma.`, sub: `Až ${TRIAL_INVOICE_LIMIT} faktur ve zkušební době. Tarif se strhne až po ní a zrušit jde kdykoli.` },
};

const DRAFT_KEY = "splatno:onboarding-draft";
const EMPTY: OnboardingCompany = normalizeOnboardingCompany({});

function readDraft(): { company: OnboardingCompany; invites: Invite[]; reminders: Reminders } | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { company?: unknown; invites?: unknown; reminders?: Partial<Reminders> };
    const invites = Array.isArray(parsed.invites)
      ? parsed.invites.filter((invite): invite is Invite =>
          typeof invite?.email === "string" && ["viewer", "accounting", "admin"].includes(invite?.role))
      : [];
    const days = Array.isArray(parsed.reminders?.days) ? parsed.reminders.days.filter((day) => DAY_OPTIONS.includes(day)) : DEFAULT_REMINDERS.days;
    return {
      company: normalizeOnboardingCompany(parsed.company),
      invites,
      reminders: {
        days: days.length ? days : DEFAULT_REMINDERS.days,
        replyTo: typeof parsed.reminders?.replyTo === "string" ? parsed.reminders.replyTo : "",
        ccText: typeof parsed.reminders?.ccText === "string" ? parsed.reminders.ccText : "",
      },
    };
  } catch {
    return null;
  }
}

function writeDraft(value: { company: OnboardingCompany; invites: Invite[]; reminders: Reminders } | null) {
  try {
    if (value) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Bez úložiště se rozpracovaný onboarding jen nezapamatuje.
  }
}

// Průvodce založením firmy. Nic se nezakládá průběžně: firma vznikne naráz
// až tlačítkem „Dokončit nastavení“ (R3). Rozpracované údaje se drží jen
// v prohlížeči, takže zavření stránky nic napůl nezaloží.
export function OnboardingClient({ accountEmail, accountName, payment }: { accountEmail: string; accountName: string; payment: PaymentContext | null }) {
  const [step, setStep] = useState<Step>(payment ? 8 : 1);
  const [reached, setReached] = useState<Step>(payment ? 8 : 1);
  const [company, setCompany] = useState<OnboardingCompany>({ ...EMPTY, email: accountEmail });
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AccessRole>("accounting");
  const [ares, setAres] = useState<AresState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [reminders, setReminders] = useState<Reminders>(DEFAULT_REMINDERS);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [created, setCreated] = useState(Boolean(payment));
  const [canPay, setCanPay] = useState(payment ? payment.canManage : true);
  const [plan, setPlan] = useState<PlanId>(payment?.plan && findPlan(payment.plan) ? payment.plan as PlanId : "profi");
  const [period, setPeriod] = useState<BillingPeriod>(isBillingPeriod(payment?.period) ? payment.period : "monthly");
  const [paymentState, setPaymentState] = useState<PaymentState>("idle");
  const [paymentInfo, setPaymentInfo] = useState<string | null>(null);
  const [denied, setDenied] = useState<Denied | null>(null);
  // Ukládat rozpracovaný stav smíme až po jeho načtení; jinak by první
  // vykreslení s prázdnými poli přepsalo uložený koncept.
  const [draftLoaded, setDraftLoaded] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const shownStep = useRef(step);

  // Nový krok začíná nahoře a fokus jde na jeho nadpis (telefon s dlouhým
  // formulářem, čtečky obrazovky, ovládání klávesnicí). Jen při změně kroku,
  // ne při prvním vykreslení.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    window.scrollTo({ top: 0 });
    const heading = paneRef.current?.querySelector("h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }, [step]);

  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      setCompany({ ...draft.company, email: draft.company.email || accountEmail });
      setInvites(draft.invites);
      setReminders(draft.reminders);
    }
    setDraftLoaded(true);
  }, [accountEmail]);

  useEffect(() => {
    if (draftLoaded && !created) writeDraft({ company, invites, reminders });
  }, [company, invites, reminders, created, draftLoaded]);

  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  async function chooseLogo(file: File | null) {
    setError(null);
    if (!file) {
      setLogoFile(null);
      setLogoPreview(null);
      return;
    }
    if (file.size > MAX_LOGO_BYTES) return setError("Logo může mít nejvýš 512 kB.");
    if (!detectLogoType(new Uint8Array(await file.slice(0, 16).arrayBuffer()))) return setError("Logo musí být obrázek PNG, JPEG nebo WebP.");
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  function remindersProblem() {
    if (!reminders.days.length) return "Vyberte aspoň jeden den, kdy zákazníkovi připomenout fakturu.";
    if (reminders.replyTo && !isValidEmail(reminders.replyTo)) return "Adresa pro odpovědi nemá platný tvar.";
    const cc = parseReminderCcInput(reminders.ccText);
    if (cc.length > MAX_REMINDER_CC_RECIPIENTS || cc.some((email) => !isValidEmail(email))) {
      return `Kopie: zadejte nejvýš ${MAX_REMINDER_CC_RECIPIENTS} platných adres oddělených čárkou.`;
    }
    return null;
  }

  const allErrors = useMemo(() => validateOnboardingCompany(company), [company]);

  function update(field: keyof OnboardingCompany, value: string) {
    setCompany((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function lookupIco(rawIco: string) {
    const ico = rawIco.replace(/\s/g, "");
    if (!isValidIco(ico)) return;
    setAres("loading");
    try {
      const response = await fetch("/api/onboarding/ares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ico }),
      });
      const data = await response.json().catch(() => null) as
        | { status?: string; subject?: { name: string; dic: string | null; address: string | null } }
        | null;
      if (data?.status === "found" && data.subject) {
        const subject = data.subject;
        setCompany((current) => ({
          ...current,
          name: current.name || subject.name,
          dic: current.dic || subject.dic || "",
          registered_address: current.registered_address || subject.address || "",
        }));
        setAres("found");
      } else {
        setAres(data?.status === "not_found" ? "not_found" : "unavailable");
      }
    } catch {
      setAres("unavailable");
    }
  }

  // Kontrola polí jednoho kroku; ostatní kroky se kontrolují až na nich.
  function validateStep(target: Step) {
    const fields: Record<number, (keyof OnboardingCompany)[]> = {
      1: ["name", "ico", "dic"],
      2: ["email"],
      3: ["bank_account_czk", "bank_account_eur"],
    };
    const relevant = fields[target] ?? [];
    const errors = Object.fromEntries(
      allErrors.filter((item) => relevant.includes(item.field as keyof OnboardingCompany)).map((item) => [item.field, item.message]),
    );
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function go(next: Step) {
    setError(null);
    if (created) return;
    if (next === 8) return;
    if (next > step && !validateStep(step)) return;
    if (next > step && step === 4) {
      const problem = remindersProblem();
      if (problem) return setError(problem);
    }
    setStep(next);
    setReached((current) => (next > current ? next : current));
  }

  function addInvite() {
    const email = normalizeEmail(inviteEmail);
    if (!isValidEmail(email)) return setError("Zadejte platný e-mail kolegy.");
    if (email === normalizeEmail(accountEmail)) return setError("Sebe zvát nemusíte, budete administrátor firmy.");
    if (invites.some((invite) => invite.email === email)) return setError("Tento e-mail už v seznamu je.");
    setError(null);
    setInvites((current) => [...current, { email, role: inviteRole }]);
    setInviteEmail("");
  }

  async function finish() {
    setError(null);
    const problems = validateOnboardingCompany(company);
    if (problems.length) {
      setError(problems[0].message);
      return;
    }
    // R6: e-mail třetí straně jen po potvrzení s rozsahem dopadu.
    if (invites.length) {
      const confirmed = await confirmAction({
        title: invites.length === 1 ? "Poslat 1 pozvánku?" : `Poslat ${invites.length} pozvánky?`,
        description: `Po založení firmy odejde pozvánka na: ${invites.map((invite) => `${invite.email} (${roleNames[invite.role]})`).join(", ")}.`,
        confirmLabel: "Založit firmu a poslat",
        confirmVariant: "primary",
      });
      if (!confirmed) return;
    }

    setSubmitting(true);
    const response = await fetch("/api/onboarding/organization", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(company),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { error?: string; code?: string; fields?: { field: string; message: string }[] } | null;
    if (!response?.ok) {
      if (data?.code === "already_member") {
        writeDraft(null);
        window.location.replace("/dashboard");
        return;
      }
      if (data?.fields) setFieldErrors(Object.fromEntries(data.fields.map((item) => [item.field, item.message])));
      setError(data?.error ?? "Firmu se nepodařilo založit. Zkontrolujte připojení a zkuste to znovu.");
      setSubmitting(false);
      return;
    }

    // Firma existuje. Zbytek nastavení (upomínky, logo, pozvánky) se uloží
    // po krocích; co se nepovede, jde dodělat v Nastavení a firma tím nijak
    // neutrpí. Varování uvidí uživatel na kroku Tarif a karta.
    const warnings: string[] = [];
    const cc = parseReminderCcInput(reminders.ccText);
    const savedReminders = await fetch("/api/settings/reminders", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        active: false,
        days: reminders.days,
        templates: Object.fromEntries(REMINDER_STAGES.map((stage) => [stage, {
          ...defaultReminderTemplates[stage],
          reply_to: reminders.replyTo || company.email,
          cc,
        }])),
      }),
    }).then((saved) => saved.ok).catch(() => false);
    if (!savedReminders) warnings.push("Nastavení upomínek se nepodařilo uložit, dokončete ho v sekci Upomínky.");
    if (logoFile) {
      const form = new FormData();
      form.append("logo", logoFile);
      const uploaded = await fetch("/api/settings/logo", { method: "POST", body: form }).then((saved) => saved.ok).catch(() => false);
      if (!uploaded) warnings.push("Logo se nepodařilo nahrát, zkuste to v Nastavení → Firma.");
    }
    const failed: string[] = [];
    for (const invite of invites) {
      const sent = await fetch("/api/settings/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invite),
      }).then(async (inviteResponse) => {
        const body = await inviteResponse.json().catch(() => null) as { invitation?: { sent?: boolean } } | null;
        return inviteResponse.ok && body?.invitation?.sent === true;
      }).catch(() => false);
      if (!sent) failed.push(invite.email);
    }
    if (failed.length) warnings.push(`Pozvánku se nepodařilo poslat na: ${failed.join(", ")}. Pošlete ji znovu v Nastavení → Tým.`);
    writeDraft(null);
    setCreated(true);
    setResult(warnings.length ? warnings.join(" ") : null);
    setSubmitting(false);
    setStep(8);
    setReached(8);
  }

  // Tarif vybraný na landing page (přes registraci) předvyplní výběr.
  useEffect(() => {
    if (payment?.plan) return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(PLAN_CHOICE_KEY) ?? "null") as { plan?: string; period?: string } | null;
      if (saved?.plan && findPlan(saved.plan)) setPlan(saved.plan as PlanId);
      if (isBillingPeriod(saved?.period)) setPeriod(saved.period);
    } catch {
      // Bez úložiště zůstane výchozí Profi měsíčně.
    }
  }, [payment?.plan]);

  function finishOnboarding() {
    writeDraft(null);
    try {
      window.localStorage.removeItem(PLAN_CHOICE_KEY);
    } catch {
      // Bez úložiště není co mazat.
    }
    setPaymentState("done");
    window.location.replace("/dashboard");
  }

  async function activate(session: string, attempt = 0): Promise<void> {
    setPaymentState("activating");
    setPaymentInfo(null);
    const response = await fetch("/api/billing/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as
      | { status?: string; reason?: string; dueNowHalere?: number; choice?: { plan: PlanId; period: BillingPeriod }; error?: string }
      | null;
    if (response?.ok && data?.status === "subscribed") return finishOnboarding();
    if (response?.ok && data?.status === "pending" && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return activate(session, attempt + 1);
    }
    if (response?.ok && data?.status === "trial_denied" && data.choice) {
      setDenied({ reason: data.reason ?? "", dueNowHalere: data.dueNowHalere ?? 0, plan: data.choice.plan, period: data.choice.period });
      setPlan(data.choice.plan);
      setPeriod(data.choice.period);
      setPaymentState("denied");
      return;
    }
    if (response?.status === 403) setCanPay(false);
    setPaymentState("idle");
    setPaymentInfo(data?.error ?? "Uložení karty se nepodařilo ověřit. Zkuste stránku za chvíli obnovit.");
  }

  // Návrat z platební brány: ?platba=hotovo&session=… nebo ?platba=zrusena.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("platba");
    if (!outcome) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (outcome === "zrusena") {
      setPaymentInfo("Karta se neuložila a nic se nestrhlo. Můžete to zkusit znovu.");
      return;
    }
    const session = params.get("session");
    if (outcome === "hotovo" && session) void activate(session);
    // Spouští se jednou po návratu z brány; activate čte jen aktuální stav.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openCardSetup() {
    setPaymentInfo(null);
    setPaymentState("redirecting");
    const response = await fetch("/api/billing/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan, period, from: "onboarding" }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { url?: string; error?: string; code?: string } | null;
    if (response?.ok && data?.url) {
      window.location.assign(data.url);
      return;
    }
    if (data?.code === "already_subscribed") return finishOnboarding();
    if (response?.status === 403) setCanPay(false);
    setPaymentState("idle");
    setPaymentInfo(data?.error ?? "Platební bránu se nepodařilo otevřít. Zkuste to prosím znovu.");
  }

  // Bez nároku na zkušební dobu se strhává hned: jen po potvrzení částky (R6).
  async function startWithoutTrial() {
    if (!denied) return;
    const name = findPlan(denied.plan)?.name ?? denied.plan;
    const confirmed = await confirmAction({
      title: `Strhnout ${formatCzk(denied.dueNowHalere)} z karty?`,
      description: `Aktivujeme tarif ${name} (${denied.period === "yearly" ? "ročně" : "měsíčně"}) pro ${payment?.companyName ?? company.name}. Další platby se strhnou automaticky na začátku každého období; zrušit můžete kdykoli v Nastavení → Předplatné.`,
      confirmLabel: `Zaplatit ${formatCzk(denied.dueNowHalere)}`,
      confirmVariant: "primary",
    });
    if (!confirmed) return;
    setPaymentState("starting");
    const response = await fetch("/api/billing/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start", confirm: true }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { status?: string; url?: string | null; error?: string } | null;
    if (response?.ok && data?.status === "subscribed") return finishOnboarding();
    if (response?.ok && data?.status === "requires_action" && data.url) {
      window.location.assign(data.url);
      return;
    }
    setPaymentState("denied");
    setPaymentInfo(data?.error ?? "Platba se nepodařila. Nic se nestrhlo; zkuste to znovu nebo jinou kartou.");
  }

  const art = ART[step];
  const icoTag = ares === "loading" ? { text: "Hledám v ARES…", tone: "ok" }
    : ares === "found" ? { text: "Doplněno z ARES", tone: "ok" }
    : ares === "not_found" ? { text: "V ARES nenalezeno", tone: "warn" }
    : ares === "unavailable" ? { text: "ARES nedostupný", tone: "warn" }
    : null;

  return (
    <main className={`${styles.page} ${inter.className}`}>
      <div className={styles.card}>
        <aside className={styles.rail} aria-label="Postup nastavení">
          <Link href="/" className={styles.logo} aria-label="Splatno"><RibbonMark size={34} /><span>splatno</span></Link>
          <div className={styles.mobileProgress} aria-hidden="true">
            <span>Krok {step} z 8 · <b>{STEPS[step - 1].title}</b></span>
            <span className={styles.progressBar}><span style={{ width: `${(step / 8) * 100}%` }} /></span>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((item, index) => {
              const number = (index + 1) as Step;
              const state = number === step ? "current" : number < reached || (number < step) ? "done" : "todo";
              return (
                <li key={item.title} data-state={state}>
                  <button type="button" disabled={number > reached || submitting || created} onClick={() => go(number)} aria-current={number === step ? "step" : undefined}>
                    <span className={styles.dot}>{state === "done" ? <Check /> : number}</span>
                    <span className={styles.stepTitle}>{item.title}</span>
                    <span className={styles.stepSub}>{item.sub}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className={styles.railFoot}>Přihlášen(a) jako {accountName}. Zabere to pár minut.</p>
        </aside>

        <section className={styles.main}>
          <div className={styles.pane} ref={paneRef}>
            <span className={styles.chip}>Krok {step} z 8</span>

            {step === 1 && (
              <>
                <h1 className={styles.title}>Řekněte nám o vaší firmě</h1>
                <p className={styles.sub}>Zadejte IČO a údaje doplníme z registru ARES. Vše můžete upravit.</p>
                <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); go(2); }}>
                  <label className={styles.field}>
                    <span className={styles.label}>IČO</span>
                    <span className={styles.control}>
                      <Home />
                      <input inputMode="numeric" enterKeyHint="next" autoComplete="off" maxLength={10} placeholder="12345678" value={company.ico}
                        aria-invalid={Boolean(fieldErrors.ico)}
                        onChange={(event) => {
                          const value = event.target.value.replace(/[^\d\s]/g, "");
                          update("ico", value);
                          setAres("idle");
                          if (value.replace(/\s/g, "").length === 8) void lookupIco(value);
                        }} />
                      {icoTag ? <span className={styles.tag} data-tone={icoTag.tone}>{icoTag.text}</span> : null}
                    </span>
                    {fieldErrors.ico ? <p className={styles.fieldError}>{fieldErrors.ico}</p> : null}
                    {ares === "unavailable" ? <p className={styles.hint}>Registr teď neodpovídá. Údaje prosím vyplňte ručně.</p> : null}
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Název firmy</span>
                    <span className={styles.control}><Home /><input autoComplete="organization" placeholder="Např. ACME s.r.o." value={company.name} aria-invalid={Boolean(fieldErrors.name)} onChange={(event) => update("name", event.target.value)} /></span>
                    {fieldErrors.name ? <p className={styles.fieldError}>{fieldErrors.name}</p> : null}
                  </label>
                  <div className={styles.pair}>
                    <label className={styles.field}>
                      <span className={styles.label}>DIČ <small>(nepovinné)</small></span>
                      <span className={`${styles.control} ${styles.plain}`}><input autoComplete="off" placeholder="CZ12345678" value={company.dic} aria-invalid={Boolean(fieldErrors.dic)} onChange={(event) => update("dic", event.target.value)} /></span>
                      {fieldErrors.dic ? <p className={styles.fieldError}>{fieldErrors.dic}</p> : null}
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Sídlo</span>
                      <span className={`${styles.control} ${styles.plain}`}><input autoComplete="street-address" placeholder="Ulice 1, 110 00 Praha" value={company.registered_address} onChange={(event) => update("registered_address", event.target.value)} /></span>
                    </label>
                  </div>
                  <div className={styles.actions}>
                    <button className={styles.primary} type="submit">Pokračovat <ArrowRight /></button>
                  </div>
                </form>
              </>
            )}

            {step === 2 && (
              <>
                <h1 className={styles.title}>Kam vám mají zákazníci psát?</h1>
                <p className={styles.sub}>Tyto údaje se objeví na fakturách a v upomínkách.</p>
                <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); go(3); }}>
                  <label className={styles.field}>
                    <span className={styles.label}>E-mail pro faktury a odpovědi</span>
                    <span className={styles.control}><Mail /><input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" autoComplete="email" placeholder="faktury@firma.cz" value={company.email} aria-invalid={Boolean(fieldErrors.email)} onChange={(event) => update("email", event.target.value)} /></span>
                    {fieldErrors.email ? <p className={styles.fieldError}>{fieldErrors.email}</p> : <p className={styles.hint}>Na tuto adresu přijdou odpovědi zákazníků na upomínky.</p>}
                  </label>
                  <div className={styles.pair}>
                    <label className={styles.field}>
                      <span className={styles.label}>Telefon <small>(nepovinné)</small></span>
                      <span className={`${styles.control} ${styles.plain}`}><input type="tel" autoComplete="tel" placeholder="+420 777 123 456" value={company.phone} onChange={(event) => update("phone", event.target.value)} /></span>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Datová schránka <small>(nepovinné)</small></span>
                      <span className={`${styles.control} ${styles.plain}`}><input autoComplete="off" placeholder="abc1234" value={company.data_box_id} onChange={(event) => update("data_box_id", event.target.value)} /></span>
                    </label>
                  </div>
                  <label className={styles.field}>
                    <span className={styles.label}>Provozovna <small>(pokud se liší od sídla)</small></span>
                    <span className={`${styles.control} ${styles.plain}`}><input autoComplete="off" value={company.operating_address} onChange={(event) => update("operating_address", event.target.value)} /></span>
                  </label>
                  <div className={styles.actions}>
                    <button className={styles.back} type="button" onClick={() => go(1)}><ArrowLeft />Zpět</button>
                    <button className={styles.primary} type="submit">Pokračovat <ArrowRight /></button>
                  </div>
                </form>
              </>
            )}

            {step === 3 && (
              <>
                <h1 className={styles.title}>Kam vám chodí platby?</h1>
                <p className={styles.sub}>Podle čísla účtu Splatno pozná příchozí platby a spáruje je s fakturami.</p>
                <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); go(4); }}>
                  <label className={styles.field}>
                    <span className={styles.label}>Účet v korunách</span>
                    <span className={styles.control}>
                      <Bank />
                      <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" autoComplete="off" placeholder="19-2000145399/0800" value={company.bank_account_czk} aria-invalid={Boolean(fieldErrors.bank_account_czk)} onChange={(event) => update("bank_account_czk", event.target.value)} />
                      {company.bank_account_czk && isValidBankAccount(company.bank_account_czk) ? <span className={styles.tag}>Číslo ověřeno</span> : null}
                    </span>
                    {fieldErrors.bank_account_czk ? <p className={styles.fieldError}>{fieldErrors.bank_account_czk}</p> : <p className={styles.hint}>Ve tvaru předčíslí-číslo/kód banky.</p>}
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Účet v eurech <small>(nepovinné)</small></span>
                    <span className={styles.control}>
                      <Bank />
                      <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" autoComplete="off" value={company.bank_account_eur} aria-invalid={Boolean(fieldErrors.bank_account_eur)} onChange={(event) => update("bank_account_eur", event.target.value)} />
                    </span>
                    {fieldErrors.bank_account_eur ? <p className={styles.fieldError}>{fieldErrors.bank_account_eur}</p> : null}
                  </label>
                  <div className={styles.info}><Bank /><p><b>Výpisy nahrajete v sekci Platby.</b> Zatím umíme výpisy Komerční banky ve formátu GPC, další banky připravujeme.</p></div>
                  <div className={styles.actions}>
                    <button className={styles.back} type="button" onClick={() => go(2)}><ArrowLeft />Zpět</button>
                    <button className={styles.primary} type="submit">Pokračovat <ArrowRight /></button>
                  </div>
                </form>
              </>
            )}

            {step === 4 && (
              <>
                <h1 className={styles.title}>Kdy připomenout neuhrazenou fakturu?</h1>
                <p className={styles.sub}>Splatno pošle zákazníkovi e-mail podle tohoto harmonogramu. Automat zůstane vypnutý, dokud ho v sekci Upomínky sami nezapnete.</p>
                <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); go(5); }}>
                  <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className={styles.label}>Dny vzhledem ke splatnosti</legend>
                    <div className={styles.dayGrid}>
                      {DAY_OPTIONS.map((day) => (
                        <label key={day} className={styles.dayOption}>
                          <input type="checkbox" checked={reminders.days.includes(day)} onChange={(event) => setReminders((current) => ({
                            ...current,
                            days: event.target.checked ? [...current.days, day].sort((a, b) => a - b) : current.days.filter((item) => item !== day),
                          }))} />
                          <span>{dayLabel(day)}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className={styles.field}>
                    <span className={styles.label}>Odpovědi zákazníků chodí na <small>(prázdné = {company.email || "e-mail firmy"})</small></span>
                    <span className={styles.control}><Mail /><input type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" inputMode="email" autoComplete="off" placeholder={company.email || "faktury@firma.cz"} value={reminders.replyTo} onChange={(event) => setReminders((current) => ({ ...current, replyTo: event.target.value }))} /></span>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Kopie upomínek <small>(nepovinné, nejvýš {MAX_REMINDER_CC_RECIPIENTS} adres)</small></span>
                    <span className={`${styles.control} ${styles.plain}`}><input autoComplete="off" placeholder="ucetni@firma.cz, jednatel@firma.cz" value={reminders.ccText} onChange={(event) => setReminders((current) => ({ ...current, ccText: event.target.value }))} /></span>
                  </label>
                  <div className={styles.info}><Bell /><p><b>Texty upomínek</b> připravíme výchozí (přátelské před splatností, důraznější po ní). Upravíte je kdykoli v sekci Upomínky.</p></div>
                  {error && <p className={styles.notice}>{error}</p>}
                  <div className={styles.actions}>
                    <button className={styles.back} type="button" onClick={() => go(3)}><ArrowLeft />Zpět</button>
                    <button className={styles.primary} type="submit">Pokračovat <ArrowRight /></button>
                  </div>
                </form>
              </>
            )}

            {step === 5 && (
              <>
                <h1 className={styles.title}>Logo vaší firmy</h1>
                <p className={styles.sub}>Zobrazí se v aplikaci a v upomínkách vašim zákazníkům. Nepovinné, přidáte ho i později.</p>
                <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); go(6); }}>
                  <label className={styles.drop}>
                    {logoPreview
                      // eslint-disable-next-line @next/next/no-img-element -- náhled místního souboru (blob:)
                      ? <img src={logoPreview} alt="Náhled loga" className={styles.logoPreview} />
                      : <FileText />}
                    <strong>{logoFile ? logoFile.name : "Vyberte obrázek s logem"}</strong>
                    <small>PNG, JPEG nebo WebP, nejvýš 512 kB</small>
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseLogo(event.target.files?.[0] ?? null)} />
                  </label>
                  {logoFile ? <button type="button" className={styles.textButton} onClick={() => void chooseLogo(null)}>Odebrat logo</button> : null}
                  {error && <p className={styles.notice}>{error}</p>}
                  <div className={styles.actions}>
                    <button className={styles.back} type="button" onClick={() => go(4)}><ArrowLeft />Zpět</button>
                    <button className={styles.primary} type="submit">{logoFile ? "Pokračovat" : "Přeskočit, přidám později"} <ArrowRight /></button>
                  </div>
                </form>
              </>
            )}

            {step === 6 && (
              <>
                <h1 className={styles.title}>Pozvěte kolegy</h1>
                <p className={styles.sub}>Každý dostane e-mail s odkazem, nastaví si heslo a hned uvidí vaši firmu. Pozvánky odejdou až po vašem potvrzení na konci.</p>
                <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); addInvite(); }}>
                  <div className={styles.inviteRow}>
                    <label className={styles.field}>
                      <span className={styles.label}>E-mail kolegy</span>
                      <span className={styles.control}><Mail /><input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" autoComplete="off" placeholder="kolega@firma.cz" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></span>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Role</span>
                      <span className={`${styles.control} ${styles.plain}`}>
                        <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as AccessRole)}>
                          <option value="accounting">{roleNames.accounting}</option>
                          <option value="viewer">{roleNames.viewer}</option>
                          <option value="admin">{roleNames.admin}</option>
                        </select>
                      </span>
                    </label>
                    <button type="submit" className={styles.addButton}>Přidat</button>
                  </div>
                  {invites.length ? (
                    <ul className={styles.invites}>
                      {invites.map((invite) => (
                        <li key={invite.email}>
                          <b>{invite.email}</b>
                          <span>{roleNames[invite.role]}</span>
                          <button type="button" className={styles.remove} onClick={() => setInvites((current) => current.filter((item) => item.email !== invite.email))}>Odebrat</button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.hint}>Účetní pracuje s fakturami a platbami, čtenář jen nahlíží, administrátor spravuje i firmu a tým.</p>
                  )}
                  {error && <p className={styles.notice}>{error}</p>}
                  <div className={styles.actions}>
                    <button className={styles.back} type="button" onClick={() => go(5)}><ArrowLeft />Zpět</button>
                    <button className={styles.primary} type="button" onClick={() => go(7)}>{invites.length ? "Pokračovat" : "Přeskočit, pozvu později"} <ArrowRight /></button>
                  </div>
                </form>
              </>
            )}

            {step === 7 && (
              <>
                <h1 className={styles.title}>Zkontrolujte a spusťte</h1>
                <p className={styles.sub}>Firma vznikne až tímto tlačítkem. Cokoli později změníte v Nastavení.</p>
                <ul className={styles.summary}>
                  <li>
                    <span className={styles.summaryIcon}><Home /></span>
                    <span><b>{company.name || "Název chybí"}</b><small>IČO {company.ico || "chybí"}{company.dic ? ` · DIČ ${company.dic}` : ""}{company.registered_address ? ` · ${company.registered_address}` : ""}</small></span>
                    <button type="button" onClick={() => go(1)}>Upravit</button>
                  </li>
                  <li>
                    <span className={styles.summaryIcon}><Mail /></span>
                    <span><b>{company.email || "E-mail chybí"}</b><small>{[company.phone, company.data_box_id ? `DS ${company.data_box_id}` : ""].filter(Boolean).join(" · ") || "Bez telefonu a datové schránky"}</small></span>
                    <button type="button" onClick={() => go(2)}>Upravit</button>
                  </li>
                  <li>
                    <span className={styles.summaryIcon}><Bank /></span>
                    <span><b>{company.bank_account_czk || "Účet chybí"}</b><small>{company.bank_account_eur ? `EUR ${company.bank_account_eur}` : "Bez eurového účtu"}</small></span>
                    <button type="button" onClick={() => go(3)}>Upravit</button>
                  </li>
                  <li>
                    <span className={styles.summaryIcon}><Bell /></span>
                    <span><b>Upomínky {reminders.days.map(dayLabel).join(", ").toLowerCase()}</b><small>Automat vypnutý · odpovědi na {reminders.replyTo || company.email}</small></span>
                    <button type="button" onClick={() => go(4)}>Upravit</button>
                  </li>
                  <li data-optional={logoFile ? undefined : ""}>
                    <span className={styles.summaryIcon}><FileText /></span>
                    <span><b>{logoFile ? "Logo připravené" : "Bez loga"}</b><small>{logoFile ? logoFile.name : "Přidáte kdykoli v Nastavení → Firma"}</small></span>
                    <button type="button" onClick={() => go(5)}>Upravit</button>
                  </li>
                  <li data-optional={invites.length ? undefined : ""}>
                    <span className={styles.summaryIcon}><Users /></span>
                    <span><b>{invites.length ? `${invites.length} ${invites.length === 1 ? "pozvánka" : invites.length < 5 ? "pozvánky" : "pozvánek"}` : "Zatím bez kolegů"}</b><small>{invites.length ? invites.map((invite) => invite.email).join(", ") : "Pozvete je kdykoli v Nastavení → Tým"}</small></span>
                    <button type="button" onClick={() => go(6)}>Upravit</button>
                  </li>
                </ul>
                {error && <p className={styles.notice} style={{ marginTop: 16 }}>{error}</p>}
                {(

                  <div className={styles.actions} style={{ marginTop: 24 }}>
                    <button className={styles.back} type="button" disabled={submitting} onClick={() => go(6)}><ArrowLeft />Zpět</button>
                    <button className={styles.primary} type="button" disabled={submitting} onClick={finish}>
                      {submitting ? "Zakládám firmu…" : "Dokončit nastavení"} <ArrowRight />
                    </button>
                  </div>
                )}
              </>
            )}
            {step === 8 && (
              <>
                <h1 className={styles.title}>{denied ? "Zkušební doba tentokrát není" : `Vyberte tarif, ${TRIAL_DAYS} dní máte zdarma`}</h1>
                <p className={styles.sub}>
                  {denied
                    ? `${DENIED_REASON[denied.reason] ?? "Na zkušební dobu tato firma nemá nárok."} Karta je uložená, ale nic se nestrhlo.`
                    : `Firma ${payment?.companyName ?? company.name} je založená. Zadejte kartu: dnes nic neplatíte, ${TRIAL_DAYS} dní zkoušíte zdarma (až ${TRIAL_INVOICE_LIMIT} faktur) a teprve potom se strhne zvolený tarif. Zrušit můžete kdykoli.`}
                </p>
                {result ? <p className={styles.notice} style={{ marginTop: 16 }}>{result}</p> : null}
                {!canPay ? (
                  <div className={styles.info} style={{ marginTop: 20 }}><Shield /><p><b>Platbu dokončuje administrátor firmy.</b> Jakmile zadá kartu, Splatno se vám otevře. Stačí potom tuto stránku obnovit.</p></div>
                ) : (
                  <div className={styles.form}>
                    <div className={styles.periodSwitch} role="radiogroup" aria-label="Období platby">
                      {(["monthly", "yearly"] as const).map((value) => (
                        <button key={value} type="button" role="radio" aria-checked={period === value} data-active={period === value || undefined}
                          disabled={Boolean(denied) || paymentState !== "idle"} onClick={() => setPeriod(value)}>
                          {value === "monthly" ? "Měsíčně" : <>Ročně <small>2 měsíce zdarma</small></>}
                        </button>
                      ))}
                    </div>
                    <div className={styles.planGrid} role="radiogroup" aria-label="Tarif">
                      {PLANS.map((item) => (
                        <label key={item.id} className={styles.planOption} data-active={plan === item.id || undefined}>
                          <input type="radio" name="plan" value={item.id} checked={plan === item.id} disabled={Boolean(denied) || paymentState !== "idle"} onChange={() => setPlan(item.id)} />
                          <span className={styles.planName}>{item.name}</span>
                          <span className={styles.planPrice}>{monthlyPrice(item.id, period).toLocaleString("cs-CZ")} Kč <small>/ měsíc bez DPH</small></span>
                          <span className={styles.planNote}>{item.features[0]}</span>
                        </label>
                      ))}
                    </div>
                    <div className={styles.info}>
                      <Check />
                      <p>
                        {denied
                          ? <><b>Dnes zaplatíte {formatCzk(denied.dueNowHalere)}.</b> Další platba za {denied.period === "yearly" ? "rok" : "měsíc"} se strhne automaticky.</>
                          : <><b>Dnes 0 Kč.</b> Po {TRIAL_DAYS} dnech {formatCzk(quote(plan, period).netHalere)} bez DPH za {period === "yearly" ? "rok" : "měsíc"}. Tarif změníte kdykoli.</>}
                      </p>
                    </div>
                    {paymentInfo ? <p className={styles.notice}>{paymentInfo}</p> : null}
                    <div className={styles.actions}>
                      {denied ? (
                        <button className={styles.primary} type="button" disabled={paymentState === "starting"} onClick={() => void startWithoutTrial()}>
                          {paymentState === "starting" ? "Platím…" : `Zaplatit ${formatCzk(denied.dueNowHalere)} a začít`} <ArrowRight />
                        </button>
                      ) : (
                        <button className={styles.primary} type="button" disabled={paymentState !== "idle"} onClick={() => void openCardSetup()}>
                          {paymentState === "redirecting" ? "Otevírám platební bránu…" : paymentState === "activating" ? "Ověřuji kartu…" : "Zadat kartu a začít zdarma"} <ArrowRight />
                        </button>
                      )}
                    </div>
                    <p className={styles.hint}>Kartu zpracovává Stripe, Splatno číslo karty nikdy nevidí.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <aside className={styles.art} aria-hidden="true">
          <Image src={art.src} alt="" width={760} height={662} className={styles.mascot} sizes="380px" priority />
          <p className={styles.artTitle}>{art.title}</p>
          <p className={styles.artSub}>{art.sub}</p>
        </aside>
      </div>
    </main>
  );
}
