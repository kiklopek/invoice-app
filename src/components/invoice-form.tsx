"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { clearInvoiceDraft, readInvoiceDraft, saveInvoiceDraft } from "@/lib/invoice-drafts";
import type { InvoiceInput } from "@/types/invoice";
import { todayInTimeZone } from "@/lib/reminders";
import { DEFAULT_VAT_RATE, grossFromNet, netFromGross } from "@/lib/vat";
import { minorUnits } from "@/lib/money";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import type { ReminderPolicySummary } from "@/lib/reminder-policies";
import { relevantOcrWarnings, type OcrFieldName, type OcrFieldSource, type OcrReminderPolicyAssignment } from "@/lib/invoice-ocr";
import { normalizeCounterpartyIco } from "@/lib/counterparty-reminder-preferences";

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

function OcrSourceNote({ source }: { source?: OcrFieldSource }) {
  if (!source) return null;
  const method = source.method === "derived" ? "dopočítáno" : source.method === "pdf_text" ? "text PDF" : "OCR";
  return <details className="ocr-field-source"><summary>Zdroj: strana {source.page}, řádek {source.line} · {method}</summary><span>„{source.text}“</span></details>;
}

export function InvoiceForm({
  initial,
  policyAssignment: externalPolicyAssignment,
  ocrFieldSources,
  ocrWarnings,
  submitLabel = "Uložit fakturu",
  editing = false,
  onSubmit,
}: {
  initial?: InvoiceInput;
  policyAssignment?: OcrReminderPolicyAssignment;
  ocrFieldSources?: Partial<Record<OcrFieldName, OcrFieldSource>>;
  ocrWarnings?: string[];
  submitLabel?: string;
  editing?: boolean;
  onSubmit: (value: InvoiceInput) => Promise<void>;
}) {
  const pathname = usePathname();
  const draftKey = JSON.stringify([pathname, initial?.file_url ?? "", initial?.invoice_number ?? ""]);
  const [form, setForm] = useState<InvoiceInput>(() => readInvoiceDraft(draftKey) ?? initial ?? createEmptyInvoice());
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [dirty, setDirty] = useState(() => Boolean(readInvoiceDraft(draftKey)));
  const [error, setError] = useState("");
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

  const needsAmountReview = amountDifference !== 0;
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
  if (amountDifference !== 0 && (!form.money_evidence?.adjustment_confirmed || !form.money_evidence.adjustment_reason.trim())) submitBlockers.push("Vysvětlete a potvrďte rozdíl mezi celkovou částkou a výpočtem DPH.");
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitAttempted(true);
    // Only surfaced once the accountant actually tries to save -- showing
    // this checklist proactively while they're still in the middle of
    // filling the form in would just be noise about fields they haven't
    // gotten to yet.
    if (submitBlockers.length) return;
    setSaving(true); setError("");
    try {
      setDirty(false); await onSubmit(form); clearInvoiceDraft(draftKey);
    }
    catch (cause) { setDirty(true); setError(cause instanceof Error ? cause.message : "Fakturu se nepodařilo uložit."); }
    finally { setSaving(false); }
  }

  return <form className="standalone-form" onSubmit={submit}>
    {form.file_url && <div className="form-document-note"><strong>Dokument je přiložen</strong><span>Údaje před uložením pečlivě zkontrolujte.</span></div>}
    {visibleWarnings.length > 0 && <div className="ocr-warnings"><strong>Co je potřeba ověřit</strong><ul>{visibleWarnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}
    <section className="form-section"><div className="form-section-title"><span>1</span><div><h2>Identifikace faktury</h2><p>Čísla, podle kterých fakturu dohledáte v účetnictví.</p></div></div><div className="form-grid">
      <label><span>Číslo faktury *</span><input required value={form.invoice_number} onChange={e => field("invoice_number", e.target.value)} placeholder="např. FV-2026-001"/><OcrSourceNote source={source("invoice_number")}/></label>
      <label><span>Variabilní symbol</span><input value={form.variable_symbol} onChange={e => field("variable_symbol", e.target.value)} placeholder="např. 2026001"/><OcrSourceNote source={source("variable_symbol")}/></label>
      <label><span>Datum vystavení *</span><input type="date" required value={form.issue_date} onChange={e => field("issue_date", e.target.value)}/><OcrSourceNote source={source("issue_date")}/></label>
      <label><span>Datum splatnosti *</span><input type="date" required min={form.issue_date} value={form.due_date} onChange={e => field("due_date", e.target.value)}/><OcrSourceNote source={source("due_date")}/></label>
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
    </div></section>
    <section className="form-section"><div className="form-section-title"><span>2</span><div><h2>Odběratel</h2><p>Firma, která má fakturu uhradit.</p></div></div><div className="form-grid">
      <label className="wide customer-name-field">
        <span>Název odběratele *</span>
        <input
          required
          value={form.counterparty_name}
          onChange={e => handleCounterpartyNameInput(e.target.value)}
          onFocus={() => { if (customerMatches.length) setCustomerDropdownOpen(true); }}
          onBlur={() => { window.setTimeout(() => setCustomerDropdownOpen(false), 150); }}
          placeholder="Název firmy"
          autoComplete="off"
        />
        {customerDropdownOpen && customerMatches.length > 0 && (
          <ul className="customer-search-results" role="listbox">
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
        <OcrSourceNote source={source("counterparty_name")}/>
      </label>
      <label><span>IČO</span><input value={form.counterparty_ico} onChange={e => field("counterparty_ico", e.target.value)} inputMode="numeric" placeholder="12345678"/><OcrSourceNote source={source("counterparty_ico")}/></label>
      <label><span>DIČ</span><input value={form.counterparty_dic} onChange={e => field("counterparty_dic", e.target.value)} placeholder="CZ12345678"/><OcrSourceNote source={source("counterparty_dic")}/></label>
      <label className="wide"><span>E-mail pro upomínky *</span><input type="email" required value={form.counterparty_email} onChange={e => field("counterparty_email", e.target.value)} placeholder="fakturace@odberatel.cz"/><small>Na tuto adresu budou chodit automatické upomínky.</small><OcrSourceNote source={source("counterparty_email")}/></label>
    </div></section>
    <section className="form-section"><div className="form-section-title"><span>3</span><div><h2>Částka a poznámka</h2><p>Hodnota pohledávky a interní informace.</p></div></div><div className="form-grid">
      <label><span>Částka bez DPH *</span><input type="number" required min="0.01" step="0.01" inputMode="decimal" value={form.amount_without_vat || ""} onChange={e => setNetAmount(Number(e.target.value))} placeholder="0,00"/><OcrSourceNote source={source("amount_without_vat")}/></label>
      <label><span>Sazba DPH (%) *</span><input type="number" required min="0" max="100" step="0.01" inputMode="decimal" value={form.vat_rate} onChange={e => setVatRate(Number(e.target.value))} placeholder="21"/><small>Běžná sazba je předvyplněna na 21 %, lze zadat i 0 % nebo jinou sazbu.</small><OcrSourceNote source={source("vat_rate")}/></label>
      <label><span>Celková hodnota faktury *</span><input type="number" required min="0.01" step="0.01" inputMode="decimal" value={form.amount || ""} onChange={e => setGrossAmount(Number(e.target.value))} placeholder="0,00"/><small>{form.file_url || form.source === "ocr" ? "Částka z dokumentu se při změně základu nebo DPH nepřepočítává." : "Po změně se automaticky dopočítá částka bez DPH."}</small><OcrSourceNote source={source("amount")}/></label>
      {(needsAmountReview || detectedPrepayment || (!editing && Boolean(form.file_url))) && <div className="wide invoice-money-review">
        {needsAmountReview && <p>Výpočet ze základu a sazby: {calculatedTotal.toFixed(2)} {form.currency}. Rozdíl: {amountDifference.toFixed(2)} {form.currency}.</p>}
        {needsAmountReview && <>
          {!form.money_evidence?.multi_rate && <button type="button" className="btn secondary compact" onClick={() => { setGrossAmount(calculatedTotal); }}>Přepočítat celkem na {calculatedTotal.toFixed(2)} {form.currency}</button>}
          <label><span>Důvod rozdílu (zaokrouhlení, více sazeb nebo jiná položka)</span><input required value={form.money_evidence?.adjustment_reason ?? ""} onChange={e => updateMoneyEvidence({ adjustment_reason: e.target.value, adjustment_confirmed: false })}/></label>
          <label className="invoice-money-confirm"><input type="checkbox" required checked={form.money_evidence?.adjustment_confirmed ?? false} onChange={e => updateMoneyEvidence({ adjustment_confirmed: e.target.checked })}/>Potvrzuji celkovou hodnotu a rozdíl podle dokumentu.</label>
        </>}
        {editing && detectedPrepayment && <p>Počáteční úhrada při importu: {form.money_evidence?.initial_paid.toFixed(2)} {form.currency}. Opravy provádějte v evidenci plateb.</p>}
        {!editing && Boolean(form.file_url) && <>
          <label><span>Již uhrazené zálohy / úhrady před importem</span><input type="number" min="0" max={form.amount} step="0.01" value={form.money_evidence?.initial_paid ?? 0} onChange={e => updateMoneyEvidence({ initial_paid: Number(e.target.value), initial_paid_confirmed: false })}/><small>Zbývá k úhradě: {((minorUnits(form.amount) - minorUnits(form.money_evidence?.initial_paid ?? 0)) / 100).toFixed(2)} {form.currency}</small></label>
          {detectedPrepayment && <label className="invoice-money-confirm"><input required type="checkbox" checked={form.money_evidence?.initial_paid_confirmed ?? false} onChange={e => updateMoneyEvidence({ initial_paid_confirmed: e.target.checked })}/>Potvrzuji, že tyto úhrady již proběhly. Budou zapsány do evidence úhrad.</label>}
        </>}
      </div>}
      <label><span>Měna</span><select value={form.currency} onChange={e => field("currency", e.target.value)}><option>CZK</option><option>EUR</option><option>USD</option></select><OcrSourceNote source={source("currency")}/></label>
      <label className="wide"><span>Interní poznámka</span><textarea value={form.notes} onChange={e => field("notes", e.target.value)} placeholder="Volitelná poznámka pro účetní oddělení"/></label>
    </div></section>
    {submitAttempted && submitBlockers.length > 0 && <div className="form-error form-submit-blockers"><strong>Než fakturu uložíte, opravte prosím:</strong><ul>{submitBlockers.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>}
    {error && <p className="form-error">{error}</p>}
    <div className="form-submit"><button className="btn primary" disabled={saving}>{saving ? "Ukládám…" : submitLabel}</button></div>
  </form>;
}
