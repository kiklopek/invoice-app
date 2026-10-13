"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import {
  FLAG_REASON_LABELS,
  formatMoney,
  openAmount,
  type FlagKind,
  type FlagReason,
  type NetworkInvoice,
} from "@/lib/partner-network";

export type FlagTarget = { invoice: NetworkInvoice; kind: FlagKind; partnerName: string };

function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

// Připomínka k faktuře od partnera. Jen viditelný záznam pro vystavitele:
// stav faktury ani zaplacenou částku nemění, o tom rozhoduje vystavitel.
export function FlagInvoiceModal({ target, onClose, onSaved }: {
  target: FlagTarget | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [reason, setReason] = useState<FlagReason>("price");
  const [note, setNote] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!target) return null;
  const { invoice, kind, partnerName } = target;
  const remaining = openAmount(invoice);
  const dispute = kind === "disputed";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsedAmount = Number((amount || String(remaining)).replace(/\s/g, "").replace(",", "."));
    if (!dispute && (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > remaining + 0.001)) {
      setError(`Zadejte částku od 0,01 do ${formatMoney(remaining, invoice.currency, 2)}.`);
      return;
    }
    if (dispute && reason === "other" && !note.trim()) {
      setError("U jiného důvodu napište krátké vysvětlení.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/partners/flags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(dispute
          ? { invoice_id: invoice.id, kind, reason, note: note.trim() || null }
          : { invoice_id: invoice.id, kind, paid_on: paidOn, amount: Math.round(parsedAmount * 100) / 100, note: note.trim() || null }),
      });
      setNote("");
      setAmount("");
      onSaved(dispute
        ? `Rozpor k faktuře ${invoice.invoice_number} uvidí ${partnerName}.`
        : `${partnerName} uvidí, že jste fakturu ${invoice.invoice_number} zaplatili.`);
    } catch (cause) {
      setError(cause instanceof ApiRequestError || cause instanceof Error ? cause.message : "Připomínku se nepodařilo uložit.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={Boolean(target)} onClose={onClose} closeDisabled={saving} labelledBy="network-flag-title" className="network-flag-modal">
      <header>
        <div>
          <small>{dispute ? "ROZPOR K FAKTUŘE" : "OZNÁMENÍ PLATBY"}</small>
          <h2 id="network-flag-title">{dispute ? `Rozporovat fakturu ${invoice.invoice_number}?` : `Oznámit platbu faktury ${invoice.invoice_number}?`}</h2>
          <p>{partnerName} · zbývá {formatMoney(remaining, invoice.currency, 2)}</p>
        </div>
        <button type="button" aria-label="Zavřít" disabled={saving} onClick={onClose}>×</button>
      </header>
      <form className="network-flag-form" onSubmit={submit}>
        <div className="form-grid">
          {dispute ? (
            <label className="wide">
              <span>Důvod</span>
              <select value={reason} onChange={(event) => setReason(event.target.value as FlagReason)}>
                {(Object.keys(FLAG_REASON_LABELS) as FlagReason[]).map((key) => <option key={key} value={key}>{FLAG_REASON_LABELS[key]}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label>
                <span>Datum platby</span>
                <input type="date" required max={today()} value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
              </label>
              <label>
                <span>Zaplacená částka ({invoice.currency})</span>
                <input inputMode="decimal" placeholder={String(remaining).replace(".", ",")} value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
            </>
          )}
          <label className="wide">
            <span>{dispute ? "Vysvětlení pro vystavitele" : "Poznámka (nepovinné)"}</span>
            <textarea maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder={dispute ? "Co na faktuře nesedí?" : "Např. číslo transakce nebo účet, ze kterého jste platili."} />
          </label>
        </div>
        <p className="network-modal-note">
          {dispute
            ? "Vystavitel uvidí rozpor u faktury a rozhodne o něm. Faktura se tím nezmění ani nestornuje."
            : "Vystavitel uvidí vaše oznámení. Za zaplacenou fakturu ji označí až on – po spárování platby ve výpisu nebo ručně."}
        </p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer>
          <button type="button" className="btn secondary" disabled={saving} onClick={onClose}>Zrušit</button>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? "Ukládám…" : dispute ? "Odeslat rozpor" : "Oznámit platbu"}</button>
        </footer>
      </form>
    </Modal>
  );
}
