"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "./chevron-down";
import { Icon } from "@/components/icons";
import { InvoiceFormSection } from "./invoice-form-section";
import { OcrSourceNote } from "./ocr-source-note";
import { useSmallMobile } from "./layout/mobile-header-slot";
import mobileStyles from "./mobile-invoice-form.module.css";
import reviewStyles from "./invoice-review-form.module.css";
import { usePathname } from "next/navigation";
import { clearInvoiceDraft, readInvoiceDraft, saveInvoiceDraft } from "@/lib/invoice-drafts";
import type { InvoiceInput } from "@/types/invoice";
import { todayInTimeZone } from "@/lib/reminders";
import { DEFAULT_VAT_RATE, grossFromNet, netFromGross } from "@/lib/vat";
import { minorUnits } from "@/lib/money";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import type { ReminderPolicySummary } from "@/lib/reminder-policies";
import { relevantOcrWarnings, type OcrFieldCandidate, type OcrFieldDecision, type OcrFieldName, type OcrFieldSource, type OcrReminderPolicyAssignment } from "@/lib/invoice-ocr";
import { normalizeCounterpartyIco } from "@/lib/counterparty-reminder-preferences";
import { alternativeOcrCandidates, backfillOcrDraft } from "@/lib/ocr-field-review";
import { INVOICE_CURRENCIES, normalizeInvoiceCurrency, unambiguousCurrency } from "@/lib/invoice-currency";
import { useAccessProfile } from "@/lib/use-access-role";

export const createEmptyInvoice = (): InvoiceInput => ({
  invoice_number: "",
  counterparty_name: "",
  counterparty_ico: "",
  counterparty_dic: "",
  counterparty_email: "",
  variable_symbol: "",
  amount_without_vat: 0,
  vat_rate: DEFAULT_VAT_RATE,
  amount: 0,
  currency: "CZK",
  issue_date: "",
  due_date: "",
  notes: "",
  source: "manual",
});

type CustomerSearchResult = { id: string; name: string; ico: string | null; dic: string | null; email: string | null };


export function InvoiceForm({
  initial,
  policyAssignment: externalPolicyAssignment,
  ocrFieldSources,
  ocrFieldDecisions,
  ocrWarnings,
  onActiveFieldChange,
  submitLabel = "Uložit fakturu",
  editing = false,
  reviewActions,
  ocrConfidence,
  onSubmit,
}: {
  initial?: InvoiceInput;
  policyAssignment?: OcrReminderPolicyAssignment;
  ocrFieldSources?: Partial<Record<OcrFieldName, OcrFieldSource>>;
  ocrFieldDecisions?: Partial<Record<OcrFieldName, OcrFieldDecision>>;
  ocrWarnings?: string[];
  /**
   * Import s náhledem dokladu: hover nebo fokus pole ukazuje jeho zdroj.
   * Na dotykovém zařízení zůstává aktivní pole viditelné po přepnutí na doklad.
   */
  onActiveFieldChange?: (field: OcrFieldName | null, candidate?: OcrFieldCandidate, options?: { value?: string | number }) => void;
  submitLabel?: string;
  editing?: boolean;
  ocrConfidence?: number;
  reviewActions?: { target: HTMLElement | null; onSkip?: () => void; onShowData?: () => void; disabled?: boolean };
  onSubmit: (value: InvoiceInput) => Promise<void>;
}) {
  const pathname = usePathname();
  const mobile = useSmallMobile();
  const mobileSteps = mobile && pathname === "/invoices/new" && !editing && !reviewActions;
  const [mobileStep, setMobileStep] = useState(1);

  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const profile = useAccessProfile();
  const draftKey = JSON.stringify([pathname, initial?.file_url ?? "", initial?.invoice_number ?? ""]);
  const [form, setForm] = useState<InvoiceInput>(() => {
    const draft = readInvoiceDraft(draftKey);
    // Neplátce DPH: nová faktura začíná na 0 %, ne na 21 %.
    if (!draft) return initial ?? { ...createEmptyInvoice(), vat_rate: profile?.vatPayer === false ? 0 : DEFAULT_VAT_RATE };
    // A saved draft can predate a later OCR retry for the same upload and
    // keep an empty currency even when the new extraction found it. Preserve
    // the person's draft when filled, but backfill that empty select from the
    // newest OCR value or its exact source row.
    const sourceCurrency = unambiguousCurrency(ocrFieldSources?.currency?.text ?? "")
      ?? unambiguousCurrency(ocrFieldSources?.amount?.text ?? "");
    // An OCR import that left the currency empty did so on purpose (several
    // currencies, or a bare "$"): keep it empty for the person to choose.
    return {
      ...backfillOcrDraft(draft, initial, ocrFieldDecisions),
      currency: normalizeInvoiceCurrency(draft.currency) || initial?.currency || sourceCurrency || (initial ? "" : "CZK"),
      // Účet nalezený na dokladu se ve formuláři neupravuje -- vezme se vždy
      // z aktuálního čtení, ne ze staršího konceptu.
      payment_account: initial?.payment_account ?? null,
    };
  });
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [dirty, setDirty] = useState(() => Boolean(readInvoiceDraft(draftKey)));
  const [error, setError] = useState("");
  useEffect(() => {
    if (error) formRef.current?.querySelector<HTMLElement>("[data-save-error]")?.focus();
  }, [error]);
  const [policies, setPolicies] = useState<ReminderPolicySummary[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(true);
  const [policiesError, setPoliciesError] = useState("");
  const [resolvedPolicyAssignment, setResolvedPolicyAssignment] = useState<OcrReminderPolicyAssignment | null>(null);
  const lastResolvedIcoRef = useRef<string | null>(null);
  const policyManuallyChangedRef = useRef(false);
  // The IČO (and whatever reminder_policy_id it already carries) as loaded,
  // before the user touches anything -- used so opening an existing invoice to
  // fix something unrelated never silently swaps its already-chosen category,
  // only actively changing the IČO (or starting a brand new invoice) does.
  const initialIcoRef = useRef(normalizeCounterpartyIco(initial?.counterparty_ico));
  const [customerMatches, setCustomerMatches] = useState<CustomerSearchResult[]>([]);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const customerNameTouchedRef = useRef(false);
  const discardingDraft = useRef(false);
  const discardDraft = useCallback(() => {
    discardingDraft.current = true;
    setDirty(false);
    clearInvoiceDraft(draftKey);
  }, [draftKey]);
  useUnsavedChanges(dirty && !saving, discardDraft);
  useEffect(() => {
    if (dirty && !discardingDraft.current) saveInvoiceDraft(draftKey, form);
  }, [draftKey, dirty, form]);
  const field = (key: keyof InvoiceInput, value: string | number) => { setDirty(true); setForm(current => ({ ...current, [key]: value })); };
  const setNetAmount = (value: number) => { setDirty(true); setForm(current => ({
    ...current,
    amount_without_vat: value,
    amount: current.file_url || current.source === "ocr" ? current.amount : grossFromNet(value, current.vat_rate),
    ...(current.money_evidence ? { money_evidence: { ...current.money_evidence, adjustment_confirmed: false } } : {}),
  })); };
  const setGrossAmount = (value: number) => { setDirty(true); setForm(current => ({
    ...current,
    amount: value,
    ...(current.money_evidence ? { money_evidence: { ...current.money_evidence, total_source: "manual" as const, adjustment_confirmed: false } } : {}),
    amount_without_vat: current.file_url || current.source === "ocr" ? current.amount_without_vat : netFromGross(value, current.vat_rate),
  })); };
  const setVatRate = (value: number) => { setDirty(true); setForm(current => ({
    ...current,
    vat_rate: value,
    amount: current.file_url || current.source === "ocr" ? current.amount : grossFromNet(current.amount_without_vat, value),
    ...(current.money_evidence ? { money_evidence: { ...current.money_evidence, adjustment_confirmed: false } } : {}),
  })); };

  const calculatedTotal = grossFromNet(form.amount_without_vat, form.vat_rate);
  const amountDifference = (minorUnits(form.amount) - minorUnits(calculatedTotal)) / 100;
  function updateMoneyEvidence(patch: Partial<NonNullable<InvoiceInput["money_evidence"]>>) {
    setDirty(true);
    setForm(current => ({ ...current, money_evidence: {
      original_total: initial?.amount ?? current.amount, total_source: "manual",
      adjustment: amountDifference, adjustment_reason: "", adjustment_confirmed: false,
      initial_paid: 0, initial_paid_confirmed: false, multi_rate: false,
      ...current.money_evidence, ...patch,
    } }));
  }

  const detectedPrepayment = (form.money_evidence?.initial_paid ?? 0) > 0;

  useEffect(() => {
    setForm(current => current.issue_date ? current : { ...current, issue_date: todayInTimeZone() });
  }, []);

  const loadPolicies = useCallback(() => {
    setPoliciesLoading(true);
    setPoliciesError("");
    fetch("/api/settings/reminder-policies")
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        const available = (data.policies as ReminderPolicySummary[]).filter(policy => !policy.archived_at || policy.id === initial?.reminder_policy_id);
        setPolicies(available);
        setForm(current => current.reminder_policy_id ? current : { ...current, reminder_policy_id: available.find(policy => policy.is_default)?.id ?? available[0]?.id });
      })
      .catch(cause => setPoliciesError(cause instanceof Error ? cause.message : "Kategorie upomínek se nepodařilo načíst."))
      .finally(() => setPoliciesLoading(false));
  }, [initial?.reminder_policy_id]);

  useEffect(() => { loadPolicies(); }, [loadPolicies]);

  // OCR import already resolves this server-side at extract-time (externalPolicyAssignment).
  // For manual creation/editing there's no such prop, so resolve it live here as the
  // accountant types/has an IČO, reusing the same remembered-per-IČO preference.
  useEffect(() => {
    if (externalPolicyAssignment || policiesLoading || !policies.length) return;
    const normalizedIco = normalizeCounterpartyIco(form.counterparty_ico);
    if (normalizedIco !== lastResolvedIcoRef.current) policyManuallyChangedRef.current = false;
    if (!normalizedIco) {
      setResolvedPolicyAssignment(null);
      return;
    }
    const timer = window.setTimeout(() => {
      fetch(`/api/invoices/reminder-policy-preference?ico=${normalizedIco}`)
        .then(response => (response.ok ? response.json() : null))
        .then((data: { assignment?: OcrReminderPolicyAssignment | null } | null) => {
          if (!data?.assignment) return;
          lastResolvedIcoRef.current = normalizedIco;
          setResolvedPolicyAssignment(data.assignment);
          const icoUnchangedSinceLoad = initial && normalizedIco === initialIcoRef.current;
          if (!policyManuallyChangedRef.current && !icoUnchangedSinceLoad) {
            setForm(current => current.reminder_policy_id === data.assignment!.policy_id
              ? current
              : { ...current, reminder_policy_id: data.assignment!.policy_id });
          }
        })
        .catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [externalPolicyAssignment, form.counterparty_ico, policies.length, policiesLoading, initial]);

  // Separate debounced typeahead for the existing customer registry, keyed off
  // "Název odběratele". Deliberately its own state/ref, independent of the
  // reminder-policy effect above -- selecting a match writes through the same
  // field() setter used everywhere else, so that effect (which watches
  // form.counterparty_ico) picks up the change naturally.
  useEffect(() => {
    if (!customerNameTouchedRef.current) return;
    const query = form.counterparty_name.trim();
    if (query.length < 2) {
      setCustomerMatches([]);
      return;
    }
    const timer = window.setTimeout(() => {
      fetch(`/api/customers/search?q=${encodeURIComponent(query)}`)
        .then(response => (response.ok ? response.json() : null))
        .then((data: { customers?: CustomerSearchResult[] } | null) => {
          setCustomerMatches(data?.customers ?? []);
          setCustomerDropdownOpen(true);
        })
        .catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [form.counterparty_name]);

  function handleCounterpartyNameInput(value: string) {
    customerNameTouchedRef.current = true;
    field("counterparty_name", value);
  }

  function selectCustomer(customer: CustomerSearchResult) {
    field("counterparty_name", customer.name);
    field("counterparty_ico", customer.ico ?? "");
    field("counterparty_dic", customer.dic ?? "");
    field("counterparty_email", customer.email ?? "");
    customerNameTouchedRef.current = false;
    setCustomerMatches([]);
    setCustomerDropdownOpen(false);
  }

  const ocrPolicyAssignment = externalPolicyAssignment ?? resolvedPolicyAssignment ?? undefined;
  const selectedPolicy = policies.find(policy => policy.id === form.reminder_policy_id);
  const policyChanged = Boolean(initial?.reminder_policy_id && selectedPolicy && selectedPolicy.id !== initial.reminder_policy_id);
  const assignmentMatchesIco = Boolean(
    ocrPolicyAssignment?.counterparty_ico
    && normalizeCounterpartyIco(form.counterparty_ico) === ocrPolicyAssignment.counterparty_ico
  );
  const rememberedPolicyChanged = Boolean(
    ocrPolicyAssignment?.status === "remembered"
    && assignmentMatchesIco
    && selectedPolicy
    && selectedPolicy.id !== ocrPolicyAssignment.policy_id
  );
  const source = (fieldName: OcrFieldName) => ocrFieldSources?.[fieldName];
  const decision = (fieldName: OcrFieldName) => ocrFieldDecisions?.[fieldName];
  const formValues = form as unknown as Partial<Record<OcrFieldName, unknown>>;
  const applyCandidate = (fieldName: OcrFieldName, value: string | number) => {
    if (fieldName === "amount") setGrossAmount(Number(value));
    else if (fieldName === "amount_without_vat") setNetAmount(Number(value));
    else if (fieldName === "vat_rate") setVatRate(Number(value));
    else field(fieldName, value);
  };
  const fieldHooks = (fieldName: OcrFieldName) => onActiveFieldChange
    ? { "data-ocr-field": fieldName, onFocusCapture: () => onActiveFieldChange(fieldName, undefined, { value: formValues[fieldName] as string | number }), onMouseEnter: () => onActiveFieldChange(fieldName, undefined, { value: formValues[fieldName] as string | number }), onMouseLeave: (event: React.MouseEvent<HTMLLabelElement>) => { if (!event.currentTarget.contains(document.activeElement)) onActiveFieldChange(null); } }
    : {};
  const ocrMeta = (fieldName: OcrFieldName) => {
    const choices = alternativeOcrCandidates(decision(fieldName), formValues[fieldName]);
    const candidateFor = (value: string | number) => decision(fieldName)?.candidates.find(candidate => String(candidate.value) === String(value));
    const optionalMissing = decision(fieldName)?.status === "missing" && ["variable_symbol", "counterparty_ico", "counterparty_dic", "currency"].includes(fieldName);
    return <>
      {(!optionalMissing || Boolean(reviewActions)) && <OcrSourceNote source={source(fieldName)} decision={decision(fieldName)} ico={form.counterparty_ico} review={Boolean(reviewActions)}/>}
      {choices.length > 0 && <span className="ocr-field-choices" role="group" aria-label="Návrhy hodnot z dokumentu">
        {choices.map(choice => <button type="button" className="btn secondary compact" key={`${fieldName}-${choice.value}`} onClick={() => applyCandidate(fieldName, choice.value)} onMouseEnter={() => onActiveFieldChange?.(fieldName, candidateFor(choice.value))} onFocus={() => onActiveFieldChange?.(fieldName, candidateFor(choice.value))}>Použít {choice.value} <small>({choice.sources.join(", ")})</small></button>)}
      </span>}
    </>;
  };
  // The submit button used to just go silently disabled whenever any of
  // these held (most often: no reminder policy selected/available) with
  // nothing on screen explaining why -- from the accountant's side, every
  // field looked filled in and nothing happened. Each reason is now spelled
  // out explicitly instead, and the button's disabled state is driven by
  // this same list so the two can never drift apart.
  const submitBlockers: string[] = [];
  if (!form.invoice_number.trim()) submitBlockers.push("Vyplňte číslo faktury.");
  if (!form.counterparty_name.trim()) submitBlockers.push("Vyplňte název odběratele.");
  if (!form.counterparty_email.trim()) submitBlockers.push("Vyplňte e-mail odběratele.");
  if (!form.issue_date) submitBlockers.push("Vyplňte datum vystavení.");
  if (!form.due_date) submitBlockers.push("Vyplňte datum splatnosti.");
  if (form.issue_date && form.due_date && form.due_date < form.issue_date) submitBlockers.push("Datum splatnosti nemůže být dřív než datum vystavení.");
  if (!(form.amount_without_vat > 0)) submitBlockers.push("Částka bez DPH musí být větší než 0.");
  if (!(form.amount > 0)) submitBlockers.push("Částka s DPH musí být větší než 0.");
  if ((form.money_evidence?.initial_paid ?? 0) > 0 && !form.money_evidence?.initial_paid_confirmed) submitBlockers.push("Potvrďte počáteční úhrady podle dokumentu.");
  if (form.vat_rate < 0 || form.vat_rate > 100) submitBlockers.push("Sazba DPH musí být mezi 0 a 100 %.");
  if (policiesLoading) submitBlockers.push("Načítají se kategorie upomínek…");
  else if (policiesError) submitBlockers.push("Kategorie upomínek se nepodařilo načíst – zkuste to znovu výše.");
  else if (!policies.length) submitBlockers.push("Organizace zatím nemá žádnou aktivní kategorii upomínek – vytvořte ji v Nastavení → Upomínky.");
  else if (!selectedPolicy) submitBlockers.push("Vyberte kategorii upomínek.");
  // Recomputed on every render against the live `form` state (not the
  // original OCR snapshot) so a "field wasn't recognized" warning disappears
  // the moment the accountant fills that field in by hand -- see
  // relevantOcrWarnings for which warnings this applies to.
  const visibleWarnings = ocrWarnings ? relevantOcrWarnings(ocrWarnings, form) : [];
  const hasOcrReview = Boolean(ocrFieldSources || ocrFieldDecisions || ocrWarnings);
  const fieldsToReview = Object.entries(ocrFieldDecisions ?? {})
    .filter(([, result]) => result && result.status !== "verified")
    .map(([name]) => name);
  const nextReviewFieldRef = useRef(0);
  const focusNextReviewField = () => {
    const fields = Array.from(formRef.current?.querySelectorAll<HTMLElement>("[data-ocr-field]") ?? [])
      .filter(node => fieldsToReview.includes(node.dataset.ocrField ?? ""));
    const control = fields[nextReviewFieldRef.current % fields.length]?.querySelector<HTMLElement>("input, select");
    control?.focus();
    control?.scrollIntoView({ block: "center", behavior: "instant" });
    nextReviewFieldRef.current += 1;
  };
  const canCopyInvoiceNumberToVariableSymbol = !editing
    && form.source === "ocr"
    && Boolean(form.file_url)
    && /^\d{1,10}$/.test(form.invoice_number.trim());
  const warningSummary = visibleWarnings.length === 1
    ? "1 údaj vyžaduje kontrolu"
    : visibleWarnings.length >= 2 && visibleWarnings.length <= 4
      ? `${visibleWarnings.length} údaje vyžadují kontrolu`
      : `${visibleWarnings.length} údajů vyžaduje kontrolu`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || reviewActions?.disabled) return;
    setSubmitAttempted(true);
    // Only surfaced once the accountant actually tries to save -- showing
    // this checklist proactively while they're still in the middle of
    // filling the form in would just be noise about fields they haven't
    // gotten to yet.
    if (submitBlockers.length) {
      window.requestAnimationFrame(() => formRef.current?.querySelector(".form-submit-blockers")?.scrollIntoView({ block: "nearest" }));
      return;
    }
    setSaving(true); setError("");
    try {
      setDirty(false); await onSubmit(form); clearInvoiceDraft(draftKey);
    }
    catch (cause) { setDirty(true); setError(cause instanceof Error ? cause.message : "Fakturu se nepodařilo uložit."); }
    finally { setSaving(false); }
  }

  function showMobileStep(step: number) {
    setMobileStep(step);
    requestAnimationFrame(() => {
      const section = formRef.current?.querySelector<HTMLElement>(`[data-invoice-form-section="${step}"]`);
      section?.scrollIntoView({ block: "start", behavior: "instant" });
      section?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    });
  }
  function nextMobileStep() {
    const section = formRef.current?.querySelector(`[data-invoice-form-section="${mobileStep}"]`);
    const fields = section?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea") ?? [];
    for (const input of fields) if (!input.reportValidity()) return;
    showMobileStep(Math.min(3, mobileStep + 1));
  }

  const submitActions = <div className="form-submit">
    {mobileSteps && mobileStep > 1 && <button type="button" className="btn secondary" disabled={saving} onClick={() => showMobileStep(mobileStep - 1)}><Icon name="arrow-left"/>Zpět</button>}
    {reviewActions && <p className="review-save-note"><Icon name={mobile ? "invoice" : "alert"}/><span><strong className={reviewStyles.saveNoteTitle}>Před uložením</strong>Zkontrolujte zejména číslo faktury, odběratele, částku a datum splatnosti. Nejisté údaje jsou zvýrazněné.</span></p>}
    {reviewActions?.onSkip && <button type="button" className="btn secondary" disabled={saving || reviewActions.disabled} onClick={reviewActions.onSkip}>Přeskočit</button>}
    {mobileSteps && mobileStep < 3 ? <button key="continue" type="button" className="btn primary" onClick={event => { event.preventDefault(); nextMobileStep(); }}>Pokračovat <Icon name="arrow-right"/></button> : <button key="save" type="submit" form={formId} className="btn primary" onClick={reviewActions?.onShowData} disabled={saving || reviewActions?.disabled}>{reviewActions && <Icon name="check"/>}{saving ? "Ukládám…" : submitLabel}</button>}
  </div>;
  return <form ref={formRef} id={formId} className={`${reviewActions ? reviewStyles.form : "standalone-form"}${pathname === "/invoices/new" || reviewActions ? ` ${mobileStyles.form}` : ""}`} onSubmit={submit}
    onKeyDown={event => { if (mobileSteps && mobileStep < 3 && event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") { event.preventDefault(); nextMobileStep(); } }}
    onInvalidCapture={event => {
      if (mobileSteps) {
        const invalid = formRef.current?.querySelector<HTMLElement>("input:invalid,select:invalid,textarea:invalid") ?? event.target as HTMLElement;
        const step = Number(invalid.closest("[data-invoice-form-section]")?.getAttribute("data-invoice-form-section"));
        if (step) setMobileStep(step);
        requestAnimationFrame(() => { invalid.focus(); invalid.scrollIntoView({ block:"center" }); });
      } else if (reviewActions) {
        reviewActions.onShowData?.();
        const control = event.target as HTMLElement;
        requestAnimationFrame(() => { control.focus(); control.scrollIntoView({ block:"center" }); });
      }
    }}>
    {mobileSteps && <ol className={mobileStyles.stepper} aria-label="Kroky zadání faktury">{["Faktura","Odběratel","Částka"].map((label,index)=><li key={label}><button type="button" aria-current={mobileStep === index+1 ? "step" : undefined} disabled={index+1 > mobileStep} data-complete={index+1 < mobileStep || undefined} onClick={() => showMobileStep(index+1)}><span>{index+1 < mobileStep ? <Icon name="check"/> : index+1}</span>{label}</button></li>)}</ol>}
    {reviewActions && fieldsToReview.length > 0 && <button type="button" className="ocr-review-summary" onClick={focusNextReviewField}><Icon name="alert"/>{fieldsToReview.length} {fieldsToReview.length === 1 ? "údaj vyžaduje" : fieldsToReview.length <= 4 ? "údaje vyžadují" : "údajů vyžaduje"} kontrolu <span>Zkontrolovat →</span></button>}
    {form.file_url && !hasOcrReview && <div className="form-document-note"><strong>Dokument je přiložen</strong><span>Údaje před uložením pečlivě zkontrolujte.</span></div>}
    {visibleWarnings.length > 0 && <details className="ocr-warnings">
      <summary><strong>{reviewActions ? `Upozornění z dokumentu (${visibleWarnings.length})` : warningSummary}</strong>{!reviewActions && <span>Zobrazit podrobnosti</span>}<ChevronDown /></summary>
      <ul>{visibleWarnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
    </details>}
    <InvoiceFormSection hidden={mobileSteps && mobileStep !== 1} number={1} title="Identifikace faktury" description="Čísla, podle kterých fakturu dohledáte v účetnictví." review={Boolean(reviewActions)} badge={hasOcrReview ? <span className={reviewStyles.ocrBadge} title={ocrConfidence !== undefined ? `Spolehlivost OCR ${Math.round(ocrConfidence * 100)} %` : undefined}><Icon name="sparkles" />Rozpoznáno pomocí OCR{ocrConfidence !== undefined ? ` · ${Math.round(ocrConfidence * 100)} %` : ""}</span> : undefined}>
      <label {...fieldHooks("invoice_number")}><span>Číslo faktury *</span><input required value={form.invoice_number} onChange={e => field("invoice_number", e.target.value)} placeholder="např. FV-2026-001" autoCapitalize="off" spellCheck={false} enterKeyHint="next"/>{ocrMeta("invoice_number")}</label>
      <div className="variable-symbol-field">
        <label {...fieldHooks("variable_symbol")}><span>Variabilní symbol</span><input value={form.variable_symbol} onChange={e => field("variable_symbol", e.target.value)} placeholder="např. 2026001" inputMode="numeric" pattern="[0-9]*" maxLength={10} enterKeyHint="next"/>{ocrMeta("variable_symbol")}</label>
        {canCopyInvoiceNumberToVariableSymbol && <button type="button" className={reviewActions ? reviewStyles.copy : "btn secondary variable-symbol-copy"} aria-label="Použít číslo faktury jako variabilní symbol" onClick={() => field("variable_symbol", form.invoice_number.trim())}>{reviewActions ? "Použít číslo faktury" : "Použít číslo faktury jako variabilní symbol"}</button>}
      </div>
      <label {...fieldHooks("issue_date")}><span>Datum vystavení *</span><input type="date" required value={form.issue_date} onChange={e => field("issue_date", e.target.value)} enterKeyHint="next"/>{ocrMeta("issue_date")}</label>
      <label {...fieldHooks("due_date")}><span>Datum splatnosti *</span><input type="date" required min={form.issue_date} value={form.due_date} onChange={e => field("due_date", e.target.value)} enterKeyHint="next"/>{ocrMeta("due_date")}</label>
      <label className="wide reminder-policy-field">
        <span>Kategorie upomínek *</span>
        <select required value={form.reminder_policy_id ?? ""} disabled={policiesLoading || Boolean(policiesError)} onChange={e => { policyManuallyChangedRef.current = true; field("reminder_policy_id", e.target.value); }}>
          <option value="" disabled>{policiesLoading ? "Načítám kategorie…" : "Vyberte kategorii"}</option>
          {policies.map(policy => <option key={policy.id} value={policy.id}>{policy.name}{policy.is_default ? " (výchozí)" : ""}{policy.archived_at ? " (archivovaná)" : ""}</option>)}
        </select>
        {ocrPolicyAssignment && selectedPolicy && (
          <span className={`ocr-policy-assignment ${ocrPolicyAssignment.status === "remembered" && assignmentMatchesIco ? "remembered" : "needs-check"}`} role="status" aria-live="polite">
            <strong>
              {!assignmentMatchesIco && ocrPolicyAssignment.counterparty_ico
                ? "IČO bylo po rozpoznání změněno."
                : ocrPolicyAssignment.status === "remembered"
                  ? `K této firmě je nastavena kategorie upomínek: ${ocrPolicyAssignment.policy_name}.`
                  : ocrPolicyAssignment.status === "missing_ico"
                    ? "Nerozpoznáno platné IČO."
                    : "Pro toto IČO zatím není nastavená kategorie upomínek."}
            </strong>
            <span>
              {rememberedPolicyChanged
                ? `Po uložení se pro tuto firmu zapamatuje kategorie ${selectedPolicy.name}.`
                : ocrPolicyAssignment.status === "remembered" && assignmentMatchesIco
                  ? "Kategorie byla vybrána automaticky podle IČO."
                  : `Nyní je vybrána kategorie ${selectedPolicy.name}. Zkontrolujte ji; po uložení faktury se pro zadané IČO zapamatuje.`}
            </span>
          </span>
        )}
        {policyChanged && !ocrPolicyAssignment && <span className="field-warning">Po uložení se budoucí plán této faktury nahradí vybranou kategorií. Zmeškané termíny se zpětně neodešlou.</span>}
        {policiesError && <span className="field-error">{policiesError} <button type="button" onClick={loadPolicies}>Zkusit znovu</button></span>}
      </label>
    </InvoiceFormSection>
    <InvoiceFormSection hidden={mobileSteps && mobileStep !== 2} number={2} title="Odběratel" description="Firma, která má fakturu uhradit." review={Boolean(reviewActions)}>
      <label {...fieldHooks("counterparty_name")} className="wide customer-name-field">
        <span>Název odběratele *</span>
        <input
          required
          value={form.counterparty_name}
          onChange={e => handleCounterpartyNameInput(e.target.value)}
          onFocus={() => { if (customerMatches.length) setCustomerDropdownOpen(true); }}
          onBlur={() => { window.setTimeout(() => setCustomerDropdownOpen(false), 150); }}
          placeholder="Název firmy"
          autoComplete="off"
          enterKeyHint="next"
        />
        {customerDropdownOpen && customerMatches.length > 0 && (
          <ul className="customer-search-results" role="listbox" data-popup>
            {customerMatches.map(customer => (
              <li key={customer.id}>
                <button type="button" onMouseDown={() => selectCustomer(customer)}>
                  <strong>{customer.name}</strong>
                  <small>{customer.ico ? `IČO ${customer.ico}` : "Bez IČO"}{customer.email ? ` · ${customer.email}` : ""}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {ocrMeta("counterparty_name")}
      </label>
      <label {...fieldHooks("counterparty_ico")}><span>IČO</span><input value={form.counterparty_ico} onChange={e => field("counterparty_ico", e.target.value)} inputMode="numeric" pattern="[0-9]*" maxLength={8} enterKeyHint="next" placeholder="12345678"/>{ocrMeta("counterparty_ico")}</label>
      <label {...fieldHooks("counterparty_dic")}><span>DIČ</span><input value={form.counterparty_dic} onChange={e => field("counterparty_dic", e.target.value)} autoCapitalize="characters" enterKeyHint="next" placeholder="CZ12345678"/>{ocrMeta("counterparty_dic")}</label>
      <label {...fieldHooks("counterparty_email")} className="wide"><span>E-mail pro upomínky *</span><input type="email" required value={form.counterparty_email} onChange={e => field("counterparty_email", e.target.value)} autoComplete="off" enterKeyHint="next" placeholder="fakturace@odberatel.cz"/><small>Na tuto adresu budou chodit automatické upomínky.</small>{ocrMeta("counterparty_email")}</label>
    </InvoiceFormSection>
    <InvoiceFormSection hidden={mobileSteps && mobileStep !== 3} number={3} title="Částka a poznámka" description="Hodnota pohledávky a interní informace." review={Boolean(reviewActions)}>
      <label {...fieldHooks("amount_without_vat")}><span>Částka bez DPH *</span><input type="number" required min="0.01" step="0.01" inputMode="decimal" enterKeyHint="next" value={form.amount_without_vat || ""} onChange={e => setNetAmount(Number(e.target.value))} placeholder="0,00"/>{ocrMeta("amount_without_vat")}</label>
      <label {...fieldHooks("vat_rate")}><span>Sazba DPH (%) *</span><input type="number" required min="0" max="100" step="0.01" inputMode="decimal" enterKeyHint="next" value={form.vat_rate} onChange={e => setVatRate(Number(e.target.value))} placeholder="21"/><small>Běžná sazba je předvyplněna na 21 %, lze zadat i 0 % nebo jinou sazbu.</small>{ocrMeta("vat_rate")}</label>
      <label {...fieldHooks("amount")}><span>Celková hodnota faktury *</span><input type="number" required min="0.01" step="0.01" inputMode="decimal" enterKeyHint="next" value={form.amount || ""} onChange={e => setGrossAmount(Number(e.target.value))} placeholder="0,00"/><small>{form.file_url || form.source === "ocr" ? "Částka z dokumentu se při změně základu nebo DPH nepřepočítává." : "Po změně se automaticky dopočítá částka bez DPH."}</small>{ocrMeta("amount")}</label>
      {detectedPrepayment && <div className="wide invoice-money-review">
        {editing && detectedPrepayment && <p>Počáteční úhrada při importu: {form.money_evidence?.initial_paid.toFixed(2)} {form.currency}. Opravy provádějte v evidenci plateb.</p>}
        {!editing && detectedPrepayment && <>
          <label><span>Již uhrazené zálohy / úhrady před importem</span><input type="number" min="0" max={form.amount} step="0.01" value={form.money_evidence?.initial_paid ?? 0} onChange={e => updateMoneyEvidence({ initial_paid: Number(e.target.value), initial_paid_confirmed: false })}/><small>Zbývá k úhradě: {((minorUnits(form.amount) - minorUnits(form.money_evidence?.initial_paid ?? 0)) / 100).toFixed(2)} {form.currency}</small></label>
          <label className="invoice-money-confirm"><input required type="checkbox" checked={form.money_evidence?.initial_paid_confirmed ?? false} onChange={e => updateMoneyEvidence({ initial_paid_confirmed: e.target.checked })}/>Potvrzuji, že tyto úhrady již proběhly. Budou zapsány do evidence úhrad.</label>
        </>}
      </div>}
      <label {...fieldHooks("currency")}><span>Měna</span><select value={form.currency} onChange={e => field("currency", e.target.value)}><option value="" disabled>Vyberte měnu</option>{INVOICE_CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)}</select>{ocrMeta("currency")}</label>
      {/* Účet firmy nalezený na dokladu: faktura ho uloží a PDF, QR i upomínky
          platí na něj. Neupravuje se (účet se volí automaticky); server ho
          uloží jen v měně faktury. */}
      {form.payment_account ? <p className="invoice-payment-account" role="note">Platba na účet: <strong>{form.payment_account}</strong> <small>(nalezený na faktuře)</small></p> : null}
      <label className="wide"><span>Interní poznámka</span><textarea value={form.notes} onChange={e => field("notes", e.target.value)} enterKeyHint="done" placeholder="Volitelná poznámka pro účetní oddělení"/></label>
    </InvoiceFormSection>
    {submitAttempted && submitBlockers.length > 0 && <div className="form-error form-submit-blockers"><strong>Než fakturu uložíte, opravte prosím:</strong><ul>{submitBlockers.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>}
    {error && <p className="form-error" role="alert" data-save-error tabIndex={-1}>{error}</p>}
    {reviewActions?.target ? createPortal(submitActions, reviewActions.target) : submitActions}
  </form>;
}
