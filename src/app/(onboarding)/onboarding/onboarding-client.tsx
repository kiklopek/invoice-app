"use client";

import Image from "next/image";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bank, Bell, Check, FileText, Home, Mail, Shield, Users } from "@/components/landing/landing-icons";
import { findPlan, formatCzk, isBillingPeriod, monthlyPrice, PLANS, quote, TRIAL_DAYS, TRIAL_INVOICE_LIMIT, type BillingPeriod, type PlanId } from "@/lib/plans";
import { RibbonMark } from "@/components/landing/landing-icons";
import { COMPANY_INPUT_LIMITS, isValidBankAccount, isValidIco } from "@/lib/company-validation";
import { confirmAction } from "@/lib/confirm-action";
import { isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { normalizeOnboardingCompany, onboardingStepForField, validateOnboardingCompany, validateOnboardingReminders, type OnboardingCompany } from "@/lib/onboarding";
import { roleNames, type AccessRole } from "@/lib/role-access";
import { defaultReminderTemplates } from "@/lib/reminder-defaults";
import { MAX_REMINDER_CC_RECIPIENTS, parseReminderCcInput } from "@/lib/reminder-recipients";
import { detectLogoType, MAX_LOGO_BYTES, MAX_LOGO_DIMENSION } from "@/lib/company-logo-file";
import { readLocalOnboardingDraft, writeLocalOnboardingDraft, type OnboardingDraft, type DraftLogo } from "@/lib/onboarding-draft";
import styles from "./onboarding.module.css";
import { OnboardingAccountSwitch } from "./onboarding-account-switch";

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

const EMPTY: OnboardingCompany = normalizeOnboardingCompany({});

// Průvodce založením firmy. Nic se nezakládá průběžně: firma vznikne naráz
// až tlačítkem „Dokončit nastavení“ (R3). Rozpracovaný krok i údaje se ukládají
// k účtu; koncept ještě nezakládá firmu ani neposílá pozvánky.
export function OnboardingClient({ accountId, accountEmail, accountName, payment, initialDraft = null }: { accountId: string; accountEmail: string; accountName: string; payment: PaymentContext | null; initialDraft?: OnboardingDraft | null }) {
  const [step, setStep] = useState<Step>(payment ? 8 : initialDraft?.step ?? 1);
  const [reached, setReached] = useState<Step>(payment ? 8 : initialDraft?.reached ?? 1);
  const [company, setCompany] = useState<OnboardingCompany>(initialDraft?.company ?? { ...EMPTY, email: accountEmail });
  // Samotné DIČ nepotvrzuje plátcovství DPH; volbu musí udělat uživatel.
  const [vatPayer, setVatPayer] = useState(initialDraft?.vatPayer ?? false);
  const [invites, setInvites] = useState<Invite[]>(initialDraft?.invites ?? []);
  const [inviteEmail, setInviteEmail] = useState(initialDraft?.inviteEmail ?? "");
  const [inviteRole, setInviteRole] = useState<AccessRole>(initialDraft?.inviteRole ?? "accounting");
  const [ares, setAres] = useState<AresState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [reminders, setReminders] = useState<Reminders>(initialDraft?.reminders ?? DEFAULT_REMINDERS);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [draftLogo, setDraftLogo] = useState<DraftLogo | null>(initialDraft?.logo ?? null);
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
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
  const aresRequest = useRef(0);
  const logoSelection = useRef(0);
  const focusErrors = useRef(false);
  const aresFilled = useRef<Partial<OnboardingCompany>>({});
  const draftSnapshot = useRef<OnboardingDraft | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const draftFinished = useRef(Boolean(payment));
  const leavingAccount = useRef(false);
  const savedStep = useRef(step);

  const saveDraft = useCallback((draft: OnboardingDraft) => {
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      if (draftFinished.current || leavingAccount.current) return;
      if (draftSnapshot.current && draft.updatedAt < draftSnapshot.current.updatedAt) return;
      try {
        const response = await fetch("/api/onboarding/draft", {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft),
          signal: AbortSignal.timeout(8000),
        });
        if (!draftFinished.current) setDraftSaveFailed(!response.ok);
      } catch { if (!draftFinished.current) setDraftSaveFailed(true); }
    });
  }, []);

  function clearDraft() {
    draftFinished.current = true;
    draftSnapshot.current = null;
    writeLocalOnboardingDraft(accountId, null);
  }

  // Nový krok začíná nahoře a fokus jde na jeho nadpis (telefon s dlouhým
  // formulářem, čtečky obrazovky, ovládání klávesnicí). Jen při změně kroku,
  // ne při prvním vykreslení.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    if (paneRef.current?.querySelector('[aria-invalid="true"]')) return;
    paneRef.current?.scrollTo({ top: 0 });
    const heading = paneRef.current?.querySelector("h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }, [step]);

  useEffect(() => {
    if (payment) { writeLocalOnboardingDraft(accountId, null); setDraftLoaded(true); return; }
    const local = readLocalOnboardingDraft(accountId);
    const draft = local && (!initialDraft || local.updatedAt > initialDraft.updatedAt) ? local : initialDraft;
    if (draft) {
      draftSnapshot.current = draft;
      setCompany({ ...draft.company, email: draft.company.email || accountEmail });
      setInvites(draft.invites);
      setReminders(draft.reminders);
      setVatPayer(draft.vatPayer);
      setStep(draft.step);
      setReached(draft.reached);
      setInviteEmail(draft.inviteEmail);
      setInviteRole(draft.inviteRole);
      setDraftLogo(draft.logo);
      if (draft.logo) {
        const bytes = Uint8Array.from(atob(draft.logo.data), char => char.charCodeAt(0));
        const file = new File([bytes], draft.logo.name, { type: detectLogoType(bytes) ?? "image/png" });
        setLogoFile(file);
        setLogoPreview(URL.createObjectURL(file));
      }
    }
    setDraftLoaded(true);
  }, [accountId, accountEmail, initialDraft, payment]);

  useEffect(() => {
    if (!draftLoaded || created || step === 8 || reached === 8) return;
    const draft: OnboardingDraft = { version: 1, step, reached, company, invites, reminders, vatPayer,
      inviteEmail, inviteRole, logo: draftLogo, updatedAt: Math.max(Date.now(), (draftSnapshot.current?.updatedAt ?? 0) + 1) };
    draftSnapshot.current = draft;
    writeLocalOnboardingDraft(accountId, draft);
    const changedStep = savedStep.current !== step;
    savedStep.current = step;
    if (changedStep) { saveDraft(draft); return; }
    const timer = window.setTimeout(() => saveDraft(draft), 400);
    return () => window.clearTimeout(timer);
  }, [accountId, step, reached, company, invites, reminders, vatPayer, inviteEmail, inviteRole, draftLogo, created, draftLoaded, saveDraft]);

  useEffect(() => {
    const flush = () => {
      const draft = draftSnapshot.current;
      if (!draft || draftFinished.current || leavingAccount.current) return;
      const body = JSON.stringify(draft);
      void fetch("/api/onboarding/draft", { method: "PUT", headers: { "content-type": "application/json" },
        body, keepalive: new Blob([body]).size < 60_000 }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  async function chooseLogo(file: File | null) {
    const selection = ++logoSelection.current;
    setError(null);
    if (!file) {
      setLogoFile(null);
      setLogoPreview(null);
      setDraftLogo(null);
      return;
    }
    if (file.size > MAX_LOGO_BYTES) return setError("Logo může mít nejvýš 512 kB.");
    const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (selection !== logoSelection.current) return;
    if (!detectLogoType(bytes)) return setError("Logo musí být obrázek PNG, JPEG nebo WebP.");
    const preview = URL.createObjectURL(file);
    try {
      const image = new window.Image();
      image.src = preview;
      await image.decode();
      if (image.naturalWidth > MAX_LOGO_DIMENSION || image.naturalHeight > MAX_LOGO_DIMENSION) throw new Error("dimensions");
      if (selection !== logoSelection.current) { URL.revokeObjectURL(preview); return; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      if (selection !== logoSelection.current) { URL.revokeObjectURL(preview); return; }
      setDraftLogo({ name: file.name, data: btoa(binary) });
      setLogoFile(file);
      setLogoPreview(preview);
    } catch {
      URL.revokeObjectURL(preview);
      if (selection === logoSelection.current) setError("Obrázek je poškozený nebo přesahuje 4096 × 4096 pixelů. Vyberte prosím jiný.");
    }
  }

  useLayoutEffect(() => {
    if (!focusErrors.current) return;
    focusErrors.current = false;
    const pane = paneRef.current;
    const input = pane?.querySelector<HTMLElement>('input[aria-invalid="true"], [aria-invalid="true"] input');
    if (!pane || !input) return;
    input.focus({ preventScroll: true });
    pane.scrollTo({ top: Math.max(0, pane.scrollTop + input.getBoundingClientRect().top - pane.getBoundingClientRect().top - 32) });
  }, [fieldErrors, step]);

  function showFieldErrors(problems: { field: string; message: string }[]) {
    focusErrors.current = problems.length > 0;
    setFieldErrors(Object.fromEntries(problems.map((item) => [item.field, item.message])));
  }

  function reminderInputProps(field: "reminder_reply_to" | "reminder_cc") {
    return {
      id: `onboarding-${field}`,
      maxLength: field === "reminder_reply_to" ? 254 : 1280,
      "aria-invalid": Boolean(fieldErrors[field]),
      "aria-describedby": [field === "reminder_reply_to" ? "onboarding-reply-to-hint" : "", fieldErrors[field] ? `onboarding-${field}-error` : ""].filter(Boolean).join(" ") || undefined,
      onBlur: () => {
        const problem = validateOnboardingReminders(reminders).find((item) => item.field === field);
        setFieldErrors((current) => ({ ...current, [field]: problem?.message ?? "" }));
      },
    };
  }

  const allErrors = useMemo(() => {
    const errors = validateOnboardingCompany(normalizeOnboardingCompany(company), { vatPayer });
    if (ares === "not_found") errors.push({ field: "ico", message: "Toto IČO nebylo nalezeno v registru ARES. Zkontrolujte ho prosím." });
    return errors;
  }, [company, vatPayer, ares]);

  function companyInputProps(field: keyof OnboardingCompany) {
    return {
      id: `onboarding-${field}`,
      name: field,
      maxLength: field === "ico" ? 11 : COMPANY_INPUT_LIMITS[field],
      "aria-invalid": Boolean(fieldErrors[field]),
      "aria-describedby": fieldErrors[field] ? `onboarding-${field}-error` : undefined,
      onBlur: () => {
        const problem = allErrors.find((item) => item.field === field);
        setFieldErrors((current) => ({ ...current, [field]: problem?.message ?? "" }));
      },
    };
  }

  function update(field: keyof OnboardingCompany, value: string) {
    if (field === "ico") {
      aresRequest.current += 1;
      setAres("idle");
    }
    setCompany((current) => {
      const next = { ...current, [field]: value };
      if (field === "ico") {
        for (const key of ["name", "dic", "registered_address"] as const) {
          if (current[key] === aresFilled.current[key]) next[key] = "";
        }
      }
      return next;
    });
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  const lookupIco = useCallback(async (rawIco: string) => {
    const ico = rawIco.replace(/\s/g, "");
    if (!isValidIco(ico)) return;
    const request = ++aresRequest.current;
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
      if (request !== aresRequest.current) return;
      if (response.ok && data?.status === "found" && data.subject) {
        const subject = { name: data.subject.name, dic: data.subject.dic || "", registered_address: data.subject.address || "" };
        const previous = aresFilled.current;
        setCompany((current) => current.ico.replace(/\s/g, "") !== ico ? current : {
          ...current,
          ...Object.fromEntries(Object.entries(subject).map(([key, value]) => [key,
            !current[key as keyof OnboardingCompany] || current[key as keyof OnboardingCompany] === previous[key as keyof OnboardingCompany]
              ? value : current[key as keyof OnboardingCompany],
          ])),
        });
        aresFilled.current = subject;
        setAres("found");
        setFieldErrors((current) => ({ ...current, ico: "" }));
      } else {
        const notFound = response.ok && data?.status === "not_found";
        setAres(notFound ? "not_found" : "unavailable");
        if (notFound) setFieldErrors((current) => ({ ...current, ico: "Toto IČO nebylo nalezeno v registru ARES. Zkontrolujte ho prosím." }));
      }
    } catch {
      if (request === aresRequest.current) setAres("unavailable");
    }
  }, []);

  useEffect(() => {
    if (isValidIco(company.ico)) void lookupIco(company.ico);
    return () => { aresRequest.current += 1; };
  }, [company.ico, lookupIco]);

  // Kontrola polí jednoho kroku; ostatní kroky se kontrolují až na nich.
  function validateStep(target: Step) {
    const errors = allErrors.filter((item) => onboardingStepForField(item.field) === target);
    showFieldErrors(errors);
    return errors.length === 0;
  }

  function go(next: Step) {
    setError(null);
    if (created) return;
    if (next === 8) return;
    if (next > step && step === 1 && (ares === "loading" || (isValidIco(company.ico) && ares === "idle"))) return;
    if (next > step && !validateStep(step)) return;
    if (next > step && step === 4) {
      const problems = validateOnboardingReminders(reminders);
      if (problems.length) return showFieldErrors(problems);
    }
    if (next > step && step === 6 && inviteEmail.trim() && !addInvite()) return;
    setStep(next);
    setReached((current) => (next > current ? next : current));
  }

  function addInvite() {
    const email = normalizeEmail(inviteEmail);
    if (!isValidEmail(email)) {
      showFieldErrors([{ field: "invite_email", message: "Zadejte platný e-mail kolegy." }]);
      return false;
    }
    if (email === normalizeEmail(accountEmail)) { setError("Sebe zvát nemusíte, budete administrátor firmy."); return false; }
    if (invites.some((invite) => invite.email === email)) { setError("Tento e-mail už v seznamu je."); return false; }
    setError(null);
    setInvites((current) => [...current, { email, role: inviteRole }]);
    setInviteEmail("");
    setFieldErrors((current) => ({ ...current, invite_email: "" }));
    document.getElementById("onboarding-invite_email")?.focus();
    return true;
  }

  async function finish() {
    setError(null);
    const problems = validateOnboardingCompany(normalizeOnboardingCompany(company), { vatPayer });
    if (problems.length) {
      setStep(onboardingStepForField(problems[0].field) ?? 1);
      showFieldErrors(problems);
      return;
    }
    const reminderProblems = validateOnboardingReminders(reminders);
    if (reminderProblems.length) {
      setStep(4);
      showFieldErrors(reminderProblems);
      return;
    }
    if (invites.some((invite) => !isValidEmail(invite.email) || !["admin", "accounting", "viewer"].includes(invite.role))) {
      setStep(6);
      setError("Zkontrolujte e-maily a role pozvaných kolegů.");
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
    await saveQueue.current;
    const response = await fetch("/api/onboarding/organization", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...normalizeOnboardingCompany(company), vat_payer: vatPayer }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { error?: string; code?: string; fields?: { field: string; message: string }[] } | null;
    if (!response?.ok) {
      if (data?.code === "already_member") {
        clearDraft();
        window.location.replace("/dashboard");
        return;
      }
      if (data?.fields?.length) {
        setStep(onboardingStepForField(data.fields[0].field) ?? 7);
        showFieldErrors(data.fields);
      } else if (data?.code === "ico_taken") {
        setStep(1);
        showFieldErrors([{ field: "ico", message: data.error ?? "Tato firma už ve Splatnu je." }]);
      }
      setError(data?.error ?? "Firmu se nepodařilo založit. Zkontrolujte připojení a zkuste to znovu.");
      setSubmitting(false);
      return;
    }

    clearDraft();
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
    clearDraft();
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
    clearDraft();
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
          <div className={styles.railHeader}>
            <Link href="/" className={styles.logo} aria-label="Splatno"><RibbonMark size={34} /><span>splatno</span></Link>
            <OnboardingAccountSwitch
              onBeforeSignOut={() => { leavingAccount.current = true; }}
              onSignOutFailed={() => { leavingAccount.current = false; }}
            />
          </div>
          <div className={styles.mobileProgress}>
            <span>Krok {step} z 8 · <b>{STEPS[step - 1].title}</b></span>
            <span className={styles.progressBar} aria-hidden="true"><span style={{ width: `${(step / 8) * 100}%` }} /></span>
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
            <div className={styles.content}>
              <span className={styles.chip}>Krok {step} z 8</span>
              {draftSaveFailed && !created ? <p className={styles.hint} role="status">Rozpracované údaje jsou uložené v tomto prohlížeči. Uložení k účtu se nezdařilo. <button type="button" className={styles.textButton} onClick={() => { if (draftSnapshot.current) saveDraft(draftSnapshot.current); }}>Zkusit znovu</button></p> : null}

              {step === 1 && (
                <>
                  <h1 className={styles.title}>Řekněte nám o vaší firmě</h1>
                  <p className={styles.sub}>Zadejte IČO a údaje doplníme z registru ARES. Vše můžete upravit.</p>
                  <form id="onboarding-step-form" className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); go(2); }}>
                    <label className={styles.field}>
                      <span className={styles.label}>IČO</span>
                      <span className={styles.control}>
                        <Home />
                        <input inputMode="numeric" enterKeyHint="next" autoComplete="off" placeholder="12345678" {...companyInputProps("ico")} value={company.ico}
                          onChange={(event) => {
                            const value = event.target.value.replace(/[^\d\s]/g, "");
                            update("ico", value);
                          }} />
                        {icoTag ? <span className={styles.tag} data-tone={icoTag.tone}>{icoTag.text}</span> : null}
                      </span>
                      {fieldErrors.ico ? <p id="onboarding-ico-error" className={styles.fieldError}>{fieldErrors.ico}</p> : null}
                      {ares === "unavailable" ? <p className={styles.hint}>Registr teď neodpovídá. Údaje prosím vyplňte ručně.</p> : null}
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Název firmy</span>
                      <span className={styles.control}><Home /><input autoComplete="organization" placeholder="Např. ACME s.r.o." {...companyInputProps("name")} value={company.name} onChange={(event) => update("name", event.target.value)} /></span>
                      {fieldErrors.name ? <p id="onboarding-name-error" className={styles.fieldError}>{fieldErrors.name}</p> : null}
                    </label>
                    <div className={styles.pair}>
                      <label className={styles.field}>
                        <span className={styles.label}>DIČ <small>{vatPayer ? "(povinné pro plátce DPH)" : "(nepovinné)"}</small></span>
                        <span className={`${styles.control} ${styles.plain}`}><input autoComplete="off" placeholder="CZ12345678" {...companyInputProps("dic")} value={company.dic} onChange={(event) => update("dic", event.target.value)} /></span>
                        {fieldErrors.dic ? <p id="onboarding-dic-error" className={styles.fieldError}>{fieldErrors.dic}</p> : null}
                      </label>
                      <label className={styles.field}>
                        <span className={styles.label}>Sídlo</span>
                        <span className={`${styles.control} ${styles.plain}`}><input autoComplete="street-address" placeholder="Ulice 1, 110 00 Praha" {...companyInputProps("registered_address")} value={company.registered_address} onChange={(event) => update("registered_address", event.target.value)} /></span>
                        {fieldErrors.registered_address ? <p id="onboarding-registered_address-error" className={styles.fieldError}>{fieldErrors.registered_address}</p> : null}
                      </label>
                    </div>
                    <label className={styles.checkbox}>
                      <input type="checkbox" checked={vatPayer} onChange={(event) => setVatPayer(event.target.checked)} />
                      <span>Jsme plátci DPH</span>
                    </label>
                  </form>
                </>
              )}

              {step === 2 && (
                <>
                  <h1 className={styles.title}>Kam vám mají zákazníci psát?</h1>
                  <p className={styles.sub}>Tyto údaje se objeví na fakturách a v upomínkách.</p>
                  <form id="onboarding-step-form" className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); go(3); }}>
                    <label className={styles.field}>
                      <span className={styles.label}>E-mail pro faktury a odpovědi</span>
                      <span className={styles.control}><Mail /><input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" autoComplete="email" placeholder="faktury@firma.cz" {...companyInputProps("email")} value={company.email} onChange={(event) => update("email", event.target.value)} /></span>
                      {fieldErrors.email ? <p id="onboarding-email-error" className={styles.fieldError}>{fieldErrors.email}</p> : <p className={styles.hint}>Na tuto adresu přijdou odpovědi zákazníků na upomínky.</p>}
                    </label>
                    <div className={styles.pair}>
                      <label className={styles.field}>
                        <span className={styles.label}>Telefon <small>(nepovinné)</small></span>
                        <span className={`${styles.control} ${styles.plain}`}><input type="tel" autoComplete="tel" placeholder="+420 777 123 456" {...companyInputProps("phone")} value={company.phone} onChange={(event) => update("phone", event.target.value)} /></span>
                        {fieldErrors.phone ? <p id="onboarding-phone-error" className={styles.fieldError}>{fieldErrors.phone}</p> : null}
                      </label>
                      <label className={styles.field}>
                        <span className={styles.label}>Datová schránka <small>(nepovinné)</small></span>
                        <span className={`${styles.control} ${styles.plain}`}><input autoComplete="off" placeholder="abc1234" {...companyInputProps("data_box_id")} value={company.data_box_id} onChange={(event) => update("data_box_id", event.target.value)} /></span>
                        {fieldErrors.data_box_id ? <p id="onboarding-data_box_id-error" className={styles.fieldError}>{fieldErrors.data_box_id}</p> : null}
                      </label>
                    </div>
                    <label className={styles.field}>
                      <span className={styles.label}>Provozovna <small>(pokud se liší od sídla)</small></span>
                      <span className={`${styles.control} ${styles.plain}`}><input autoComplete="off" {...companyInputProps("operating_address")} value={company.operating_address} onChange={(event) => update("operating_address", event.target.value)} /></span>
                      {fieldErrors.operating_address ? <p id="onboarding-operating_address-error" className={styles.fieldError}>{fieldErrors.operating_address}</p> : null}
                    </label>
                  </form>
                </>
              )}

              {step === 3 && (
                <>
                  <h1 className={styles.title}>Kam vám chodí platby?</h1>
                  <p className={styles.sub}>Podle čísla účtu Splatno pozná příchozí platby a spáruje je s fakturami.</p>
                  <form id="onboarding-step-form" className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); go(4); }}>
                    <label className={styles.field}>
                      <span className={styles.label}>Účet v korunách</span>
                      <span className={styles.control}>
                        <Bank />
                        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" autoComplete="off" placeholder="19-2000145399/0800" {...companyInputProps("bank_account_czk")} value={company.bank_account_czk} onChange={(event) => update("bank_account_czk", event.target.value)} />
                        {company.bank_account_czk && isValidBankAccount(company.bank_account_czk) ? <span className={styles.tag}>Platný formát</span> : null}
                      </span>
                      {fieldErrors.bank_account_czk ? <p id="onboarding-bank_account_czk-error" className={styles.fieldError}>{fieldErrors.bank_account_czk}</p> : <p className={styles.hint}>Ve tvaru předčíslí-číslo/kód banky.</p>}
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Účet v eurech <small>(nepovinné)</small></span>
                      <span className={styles.control}>
                        <Bank />
                        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" autoComplete="off" {...companyInputProps("bank_account_eur")} value={company.bank_account_eur} onChange={(event) => update("bank_account_eur", event.target.value)} />
                      </span>
                      {fieldErrors.bank_account_eur ? <p id="onboarding-bank_account_eur-error" className={styles.fieldError}>{fieldErrors.bank_account_eur}</p> : null}
                    </label>
                    <div className={styles.info}><Bank /><p><b>Výpisy nahrajete v sekci Platby.</b> Ověřené máme výpisy Komerční banky (GPC). Výpisy dalších bank (GPC, CSV) načteme také, platby z nich ale párujeme jen podle variabilního symbolu, dokud jejich formát neověříme.</p></div>
                  </form>
                </>
              )}

              {step === 4 && (
                <>
                  <h1 className={styles.title}>Kdy připomenout neuhrazenou fakturu?</h1>
                  <p className={styles.sub}>Splatno pošle zákazníkovi e-mail podle tohoto harmonogramu. Automat zůstane vypnutý, dokud ho v sekci Upomínky sami nezapnete.</p>
                  <form id="onboarding-step-form" className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); go(5); }}>
                    <fieldset className={styles.field} aria-invalid={Boolean(fieldErrors.reminder_days)} aria-describedby={fieldErrors.reminder_days ? "onboarding-reminder_days-error" : undefined} style={{ border: 0, padding: 0, margin: 0 }}>
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
                      {fieldErrors.reminder_days ? <p id="onboarding-reminder_days-error" className={styles.fieldError}>{fieldErrors.reminder_days}</p> : null}
                    </fieldset>
                    <label className={styles.field}>
                      <span className={styles.label}>Jiný e-mail pro odpovědi na upomínky <small>(nepovinné)</small></span>
                      <span className={styles.control}><Mail /><input type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" inputMode="email" autoComplete="off" placeholder="Např. ucetni@firma.cz" {...reminderInputProps("reminder_reply_to")} value={reminders.replyTo} onChange={(event) => setReminders((current) => ({ ...current, replyTo: event.target.value }))} /></span>
                      <p id="onboarding-reply-to-hint" className={styles.hint}>Pokud pole necháte prázdné, odpovědi zákazníků na upomínky přijdou na {company.email || "kontaktní e-mail firmy z kroku Kontakt"}. Vyplňte jen tehdy, pokud mají odpovědi chodit jinam.</p>
                      {fieldErrors.reminder_reply_to ? <p id="onboarding-reminder_reply_to-error" className={styles.fieldError}>{fieldErrors.reminder_reply_to}</p> : null}
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Kopie upomínek <small>(nepovinné, nejvýš {MAX_REMINDER_CC_RECIPIENTS} adres)</small></span>
                      <span className={`${styles.control} ${styles.plain}`}><input autoComplete="off" placeholder="ucetni@firma.cz, jednatel@firma.cz" {...reminderInputProps("reminder_cc")} value={reminders.ccText} onChange={(event) => setReminders((current) => ({ ...current, ccText: event.target.value }))} /></span>
                      {fieldErrors.reminder_cc ? <p id="onboarding-reminder_cc-error" className={styles.fieldError}>{fieldErrors.reminder_cc}</p> : null}
                    </label>
                    <div className={styles.info}><Bell /><p><b>Texty upomínek</b> připravíme výchozí (přátelské před splatností, důraznější po ní). Upravíte je kdykoli v sekci Upomínky.</p></div>
                    {error && <p className={styles.notice}>{error}</p>}
                  </form>
                </>
              )}

              {step === 5 && (
                <>
                  <h1 className={styles.title}>Logo vaší firmy</h1>
                  <p className={styles.sub}>Zobrazí se v aplikaci a v upomínkách vašim zákazníkům. Nepovinné, přidáte ho i později.</p>
                  <form id="onboarding-step-form" className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); go(6); }}>
                    <label className={styles.drop}>
                      {logoPreview
                        // eslint-disable-next-line @next/next/no-img-element -- náhled místního souboru (blob:)
                        ? <img src={logoPreview} alt="Náhled loga" className={styles.logoPreview} />
                        : <FileText />}
                      <strong>{logoFile ? logoFile.name : "Vyberte obrázek s logem"}</strong>
                      <small>PNG, JPEG nebo WebP · nejvýš 512 kB a 4096 × 4096 px</small>
                      <input type="file" accept="image/png,image/jpeg,image/webp" aria-invalid={Boolean(error)} aria-describedby={error ? "onboarding-logo-error" : undefined} onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ""; void chooseLogo(file); }} />
                    </label>
                    {logoFile ? <button type="button" className={styles.textButton} onClick={() => void chooseLogo(null)}>Odebrat logo</button> : null}
                    {error && <p id="onboarding-logo-error" className={styles.notice}>{error}</p>}
                  </form>
                </>
              )}

              {step === 6 && (
                <>
                  <h1 className={styles.title}>Pozvěte kolegy</h1>
                  <p className={styles.sub}>Přidejte všechny kolegy, kteří budou Splatno používat. Každému nastavte roli. Pozvánky odejdou až po vašem potvrzení na konci.</p>
                  <form id="onboarding-step-form" className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); addInvite(); }}>
                    <div className={styles.inviteRow}>
                      <label className={styles.field}>
                        <span className={styles.label}>E-mail kolegy</span>
                        <span className={styles.control}><Mail /><input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" autoComplete="off" placeholder="kolega@firma.cz" id="onboarding-invite_email" maxLength={254} aria-invalid={Boolean(fieldErrors.invite_email)} aria-describedby={fieldErrors.invite_email ? "onboarding-invite_email-error" : undefined} onBlur={() => { if (inviteEmail.trim() && !isValidEmail(inviteEmail)) setFieldErrors((current) => ({ ...current, invite_email: "Zadejte platný e-mail kolegy." })); }} value={inviteEmail} onChange={(event) => { setInviteEmail(event.target.value); setError(null); setFieldErrors((current) => ({ ...current, invite_email: "" })); }} /></span>
                        {fieldErrors.invite_email ? <p id="onboarding-invite_email-error" className={styles.fieldError}>{fieldErrors.invite_email}</p> : null}
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
                      <button type="submit" className={styles.addButton}>Přidat kolegu</button>
                    </div>
                    <p className={styles.hint}>Po přidání můžete zadat další e-mail a roli. Každý kolega dostane vlastní pozvánku a nastaví si heslo.</p>
                    <p className={styles.hint} role="status">{invites.length ? `Připraveno k pozvání: ${invites.length} ${invites.length === 1 ? "kolega" : invites.length < 5 ? "kolegové" : "kolegů"}.` : "Zatím jste nepřidali žádného kolegu. Tento krok můžete přeskočit."}</p>
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
                      <p className={styles.hint}>Kartu zpracovává Stripe, Splatno číslo karty nikdy nevidí.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          {(step !== 8 || canPay) && (
            <div className={styles.actions}>
              {step > 1 && step < 8 && (
                <button className={styles.back} type="button" disabled={submitting} onClick={() => go((step - 1) as Step)}><ArrowLeft />Zpět</button>
              )}
              {step <= 5 ? (
                <button className={styles.primary} type="submit" form="onboarding-step-form" disabled={step === 1 && (ares === "loading" || (isValidIco(company.ico) && ares === "idle"))}>
                  {step === 5 && !logoFile ? "Přeskočit, přidám později" : "Pokračovat"} <ArrowRight />
                </button>
              ) : step === 6 ? (
                <button className={styles.primary} type="button" onClick={() => go(7)}>{invites.length || inviteEmail.trim() ? "Pokračovat" : "Přeskočit, pozvu později"} <ArrowRight /></button>
              ) : step === 7 ? (
                <button className={styles.primary} type="button" disabled={submitting} onClick={finish}>
                  {submitting ? "Zakládám firmu…" : "Dokončit nastavení"} <ArrowRight />
                </button>
              ) : denied ? (
                <button className={styles.primary} type="button" disabled={paymentState === "starting"} onClick={() => void startWithoutTrial()}>
                  {paymentState === "starting" ? "Platím…" : `Zaplatit ${formatCzk(denied.dueNowHalere)} a začít`} <ArrowRight />
                </button>
              ) : (
                <button className={styles.primary} type="button" disabled={paymentState !== "idle"} onClick={() => void openCardSetup()}>
                  {paymentState === "redirecting" ? "Otevírám platební bránu…" : paymentState === "activating" ? "Ověřuji kartu…" : "Zadat kartu a začít zdarma"} <ArrowRight />
                </button>
              )}
            </div>
          )}
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
