"use client";

import { useEffect, useState } from "react";
import type { InvoiceInput } from "@/types/invoice";
import { todayInTimeZone } from "@/lib/reminders";
import { DEFAULT_VAT_RATE, grossFromNet, netFromGross } from "@/lib/vat";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

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

export function InvoiceForm({
  initial,
  submitLabel = "Uložit fakturu",
  onSubmit,
}: {
  initial?: InvoiceInput;
  submitLabel?: string;
  onSubmit: (value: InvoiceInput) => Promise<void>;
}) {
  const [form, setForm] = useState<InvoiceInput>(initial ?? createEmptyInvoice());
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  useUnsavedChanges(dirty && !saving);
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

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { setDirty(false); await onSubmit(form); }
    catch (cause) { setDirty(true); setError(cause instanceof Error ? cause.message : "Fakturu se nepodařilo uložit."); }
    finally { setSaving(false); }
  }

  return <form className="standalone-form" onSubmit={submit}>
    {form.file_url && <div className="form-document-note"><strong>Dokument je přiložen</strong><span>Údaje před uložením pečlivě zkontrolujte.</span></div>}
    <section className="form-section"><div className="form-section-title"><span>1</span><div><h2>Identifikace faktury</h2><p>Čísla, podle kterých fakturu dohledáte v účetnictví.</p></div></div><div className="form-grid">
      <label><span>Číslo faktury *</span><input required value={form.invoice_number} onChange={e => field("invoice_number", e.target.value)} placeholder="např. FV-2026-001"/></label>
      <label><span>Variabilní symbol</span><input value={form.variable_symbol} onChange={e => field("variable_symbol", e.target.value)} placeholder="např. 2026001"/></label>
      <label><span>Datum vystavení *</span><input type="date" required value={form.issue_date} onChange={e => field("issue_date", e.target.value)}/></label>
      <label><span>Datum splatnosti *</span><input type="date" required min={form.issue_date} value={form.due_date} onChange={e => field("due_date", e.target.value)}/></label>
    </div></section>
    <section className="form-section"><div className="form-section-title"><span>2</span><div><h2>Odběratel</h2><p>Firma, která má fakturu uhradit.</p></div></div><div className="form-grid">
      <label className="wide"><span>Název odběratele *</span><input required value={form.counterparty_name} onChange={e => field("counterparty_name", e.target.value)} placeholder="Název firmy"/></label>
      <label><span>IČO</span><input value={form.counterparty_ico} onChange={e => field("counterparty_ico", e.target.value)} inputMode="numeric" placeholder="12345678"/></label>
      <label><span>DIČ</span><input value={form.counterparty_dic} onChange={e => field("counterparty_dic", e.target.value)} placeholder="CZ12345678"/></label>
      <label className="wide"><span>E-mail pro upomínky *</span><input type="email" required value={form.counterparty_email} onChange={e => field("counterparty_email", e.target.value)} placeholder="fakturace@odberatel.cz"/><small>Na tuto adresu budou chodit automatické upomínky.</small></label>
    </div></section>
    <section className="form-section"><div className="form-section-title"><span>3</span><div><h2>Částka a poznámka</h2><p>Hodnota pohledávky a interní informace.</p></div></div><div className="form-grid">
      <label><span>Částka bez DPH *</span><input type="number" required min="0.01" step="0.01" inputMode="decimal" value={form.amount_without_vat || ""} onChange={e => setNetAmount(Number(e.target.value))} placeholder="0,00"/></label>
      <label><span>Sazba DPH (%) *</span><input type="number" required min="0" max="100" step="0.01" inputMode="decimal" value={form.vat_rate} onChange={e => setVatRate(Number(e.target.value))} placeholder="21"/><small>Běžná sazba je předvyplněna na 21 %, lze zadat i 0 % nebo jinou sazbu.</small></label>
      <label><span>Částka s DPH *</span><input type="number" required min="0.01" step="0.01" inputMode="decimal" value={form.amount || ""} onChange={e => setGrossAmount(Number(e.target.value))} placeholder="0,00"/><small>Po změně se automaticky dopočítá částka bez DPH.</small></label>
      <label><span>Měna</span><select value={form.currency} onChange={e => field("currency", e.target.value)}><option>CZK</option><option>EUR</option><option>USD</option></select></label>
      <label className="wide"><span>Interní poznámka</span><textarea value={form.notes} onChange={e => field("notes", e.target.value)} placeholder="Volitelná poznámka pro účetní oddělení"/></label>
    </div></section>
    {error && <p className="form-error">{error}</p>}
    <div className="form-submit"><button className="btn primary" disabled={saving}>{saving ? "Ukládám…" : submitLabel}</button></div>
  </form>;
}
