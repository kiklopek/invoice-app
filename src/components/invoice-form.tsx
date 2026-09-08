"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { clearInvoiceDraft, readInvoiceDraft, saveInvoiceDraft } from "@/lib/invoice-drafts";
import type { InvoiceInput } from "@/types/invoice";
import { todayInTimeZone } from "@/lib/reminders";
import { DEFAULT_VAT_RATE, grossFromNet, netFromGross } from "@/lib/vat";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import type { ReminderPolicySummary } from "@/lib/reminder-policies";
import type { OcrFieldName, OcrFieldSource, OcrReminderPolicyAssignment } from "@/lib/invoice-ocr";
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

function OcrSourceNote({ source }: { source?: OcrFieldSource }) {
  if (!source) return null;
  const method = source.method === "derived" ? "dopočítáno" : source.method === "pdf_text" ? "text PDF" : "OCR";
  return <details className="ocr-field-source"><summary>Zdroj: strana {source.page}, řádek {source.line} · {method}</summary><span>„{source.text}“</span></details>;
}

export function InvoiceForm({
  initial,
  ocrPolicyAssignment,
  ocrFieldSources,
  submitLabel = "Uložit fakturu",
  onSubmit,
}: {
  initial?: InvoiceInput;
  ocrPolicyAssignment?: OcrReminderPolicyAssignment;
  ocrFieldSources?: Partial<Record<OcrFieldName, OcrFieldSource>>;
  submitLabel?: string;
  onSubmit: (value: InvoiceInput) => Promise<void>;
}) {
  const pathname = usePathname();
  const draftKey = JSON.stringify([pathname, initial?.file_url ?? "", initial?.invoice_number ?? ""]);
  const [form, setForm] = useState<InvoiceInput>(() => readInvoiceDraft(draftKey) ?? initial ?? createEmptyInvoice());
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(() => Boolean(readInvoiceDraft(draftKey)));
  const [error, setError] = useState("");
  const [policies, setPolicies] = useState<ReminderPolicySummary[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(true);
  const [policiesError, setPoliciesError] = useState("");
  const discardDraft = useCallback(() => clearInvoiceDraft(draftKey), [draftKey]);
  useUnsavedChanges(dirty && !saving, discardDraft);
  useEffect(() => {
    if (dirty) saveInvoiceDraft(draftKey, form);
  }, [draftKey, dirty, form]);
  const field = (key: keyof InvoiceInput, value: string | number) => { setDirty(true); setForm(current => ({ ...current, [key]: value })); };
  const setNetAmount = (value: number) => { setDirty(true); setForm(current => ({
    ...current,
    amount_without_vat: value,
    amount: grossFromNet(value, current.vat_rate),
  })); };
  const setGrossAmount = (value: number) => { setDirty(true); setForm(current => ({
    ...current,
    amount: value,
    amount_without_vat: netFromGross(value, current.vat_rate),
  })); };
  const setVatRate = (value: number) => { setDirty(true); setForm(current => ({
    ...current,
    vat_rate: value,
    amount: grossFromNet(current.amount_without_vat, value),
  })); };

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

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      if (policiesLoading || policiesError || !selectedPolicy) throw new Error("Nejdříve načtěte a vyberte kategorii upomínek.");
      setDirty(false); await onSubmit(form); clearInvoiceDraft(draftKey);
    }
    catch (cause) { setDirty(true); setError(cause instanceof Error ? cause.message : "Fakturu se nepodařilo uložit."); }
    finally { setSaving(false); }
  }

  return <form className="standalone-form" onSubmit={submit}>
    {form.file_url && <div className="form-document-note"><strong>Dokument je přiložen</strong><span>Údaje před uložením pečlivě zkontrolujte.</span></div>}
    <section className="form-section"><div className="form-section-title"><span>1</span><div><h2>Identifikace faktury</h2><p>Čísla, podle kterých fakturu dohledáte v účetnictví.</p></div></div><div className="form-grid">
      <label><span>Číslo faktury *</span><input required value={form.invoice_number} onChange={e => field("invoice_number", e.target.value)} placeholder="např. FV-2026-001"/><OcrSourceNote source={source("invoice_number")}/></label>
      <label><span>Variabilní symbol</span><input value={form.variable_symbol} onChange={e => field("variable_symbol", e.target.value)} placeholder="např. 2026001"/><OcrSourceNote source={source("variable_symbol")}/></label>
      <label><span>Datum vystavení *</span><input type="date" required value={form.issue_date} onChange={e => field("issue_date", e.target.value)}/><OcrSourceNote source={source("issue_date")}/></label>
      <label><span>Datum splatnosti *</span><input type="date" required min={form.issue_date} value={form.due_date} onChange={e => field("due_date", e.target.value)}/><OcrSourceNote source={source("due_date")}/></label>
      <label className="wide reminder-policy-field">
        <span>Kategorie upomínek *</span>
        <select required value={form.reminder_policy_id ?? ""} disabled={policiesLoading || Boolean(policiesError)} onChange={e => field("reminder_policy_id", e.target.value)}>
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
                    ? "OCR nerozpoznalo platné IČO."
                    : "Pro toto IČO zatím není nastavená kategorie upomínek."}
            </strong>
            <span>
              {rememberedPolicyChanged
                ? `Po uložení se pro tuto firmu zapamatuje kategorie ${selectedPolicy.name}.`
                : ocrPolicyAssignment.status === "remembered" && assignmentMatchesIco
                  ? "Kategorie byla vybrána automaticky podle IČO."
                  : `Nyní je vybrána kategorie ${selectedPolicy.name}. Zkontrolujte ji; po uložení OCR faktury se pro zadané IČO zapamatuje.`}
            </span>
          </span>
        )}
        {policyChanged && !ocrPolicyAssignment && <span className="field-warning">Po uložení se budoucí plán této faktury nahradí vybranou kategorií. Zmeškané termíny se zpětně neodešlou.</span>}
        {policiesError && <span className="field-error">{policiesError} <button type="button" onClick={loadPolicies}>Zkusit znovu</button></span>}
      </label>
    </div></section>
    <section className="form-section"><div className="form-section-title"><span>2</span><div><h2>Odběratel</h2><p>Firma, která má fakturu uhradit.</p></div></div><div className="form-grid">
      <label className="wide"><span>Název odběratele *</span><input required value={form.counterparty_name} onChange={e => field("counterparty_name", e.target.value)} placeholder="Název firmy"/><OcrSourceNote source={source("counterparty_name")}/></label>
      <label><span>IČO</span><input value={form.counterparty_ico} onChange={e => field("counterparty_ico", e.target.value)} inputMode="numeric" placeholder="12345678"/><OcrSourceNote source={source("counterparty_ico")}/></label>
      <label><span>DIČ</span><input value={form.counterparty_dic} onChange={e => field("counterparty_dic", e.target.value)} placeholder="CZ12345678"/><OcrSourceNote source={source("counterparty_dic")}/></label>
      <label className="wide"><span>E-mail pro upomínky *</span><input type="email" required value={form.counterparty_email} onChange={e => field("counterparty_email", e.target.value)} placeholder="fakturace@odberatel.cz"/><small>Na tuto adresu budou chodit automatické upomínky.</small><OcrSourceNote source={source("counterparty_email")}/></label>
    </div></section>
    <section className="form-section"><div className="form-section-title"><span>3</span><div><h2>Částka a poznámka</h2><p>Hodnota pohledávky a interní informace.</p></div></div><div className="form-grid">
      <label><span>Částka bez DPH *</span><input type="number" required min="0.01" step="0.01" inputMode="decimal" value={form.amount_without_vat || ""} onChange={e => setNetAmount(Number(e.target.value))} placeholder="0,00"/><OcrSourceNote source={source("amount_without_vat")}/></label>
      <label><span>Sazba DPH (%) *</span><input type="number" required min="0" max="100" step="0.01" inputMode="decimal" value={form.vat_rate} onChange={e => setVatRate(Number(e.target.value))} placeholder="21"/><small>Běžná sazba je předvyplněna na 21 %, lze zadat i 0 % nebo jinou sazbu.</small><OcrSourceNote source={source("vat_rate")}/></label>
      <label><span>Částka s DPH *</span><input type="number" required min="0.01" step="0.01" inputMode="decimal" value={form.amount || ""} onChange={e => setGrossAmount(Number(e.target.value))} placeholder="0,00"/><small>Po změně se automaticky dopočítá částka bez DPH.</small><OcrSourceNote source={source("amount")}/></label>
      <label><span>Měna</span><select value={form.currency} onChange={e => field("currency", e.target.value)}><option>CZK</option><option>EUR</option><option>USD</option></select><OcrSourceNote source={source("currency")}/></label>
      <label className="wide"><span>Interní poznámka</span><textarea value={form.notes} onChange={e => field("notes", e.target.value)} placeholder="Volitelná poznámka pro účetní oddělení"/></label>
    </div></section>
    {error && <p className="form-error">{error}</p>}
    <div className="form-submit"><button className="btn primary" disabled={saving || policiesLoading || Boolean(policiesError) || !selectedPolicy}>{saving ? "Ukládám…" : submitLabel}</button></div>
  </form>;
}
