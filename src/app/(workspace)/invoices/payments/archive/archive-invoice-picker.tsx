"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { ExactMoney } from "@/components/money-amount";
import { apiFetch } from "@/lib/api-client";
import { formatCzechDate } from "@/lib/display-date";
import { minorUnits } from "@/lib/money";
import type { PaymentsPageOpenInvoice, PaymentsPagePayment } from "@/lib/payments-page-data";
import { MatchingDropdown } from "../payment-matching-popover";
import styles from "../payment-matching.module.css";

type Candidate = PaymentsPageOpenInvoice & { due_date?: string | null; match_reasons?: string[] };

const REASONS: Record<string, string> = {
  previous: "Dříve přiřazeno",
  vs: "Shoda VS",
  amount: "Stejná částka",
  name: "Stejné jméno",
};

const remaining = (invoice: { amount: number; paid_amount: number }) =>
  (minorUnits(Number(invoice.amount)) - minorUnits(Number(invoice.paid_amount))) / 100;

/**
 * Výběr faktury pro jednu platbu v archivu: hledání a faktury seřazené podle
 * této platby (dříve přiřazená, VS, částka, jméno) se štítky důvodu, stejně
 * jako v kontrole výpisu. Jen vybírá; přiřazuje dál tlačítko „Přiřadit“.
 * Nabízí jen faktury ve stejné měně, které celou platbu pojmou (pravidlo
 * přiřazení v archivu se nemění).
 */
export function ArchiveInvoicePicker({ payment, value, known, preferIds, disabled, onChange }: {
  payment: PaymentsPagePayment;
  value: string | null;
  known: PaymentsPageOpenInvoice[];
  preferIds: string[];
  disabled?: boolean;
  onChange: (invoiceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const amount = Number(payment.amount);
  const prefer = preferIds.filter(Boolean).join(",");

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ q: query.trim(), page: "1", amount: String(amount), currency: payment.currency });
      if (payment.variable_symbol) params.set("vs", payment.variable_symbol.slice(0, 20));
      if (payment.counterparty_name) params.set("name", payment.counterparty_name.slice(0, 200));
      if (prefer) params.set("prefer", prefer);
      apiFetch<{ invoices: Candidate[]; total: number }>(`/api/payments/invoice-candidates?${params.toString()}`)
        .then((data) => {
          if (!active) return;
          setItems(data.invoices.filter((invoice) => invoice.currency === payment.currency && remaining(invoice) >= amount));
          setError("");
          setLoading(false);
        })
        .catch((cause) => {
          if (!active) return;
          setItems([]);
          setError(cause instanceof Error ? cause.message : "Faktury se nepodařilo načíst.");
          setLoading(false);
        });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, query, amount, payment.currency, payment.variable_symbol, payment.counterparty_name, prefer]);

  const selected = (value && (known.find((invoice) => invoice.id === value) ?? items.find((invoice) => invoice.id === value) ?? (chosen?.id === value ? chosen : null))) || null;

  return (
    // Vlastní relativně pozicovaný rámeček: panel výběru se pozicuje vůči
    // rodiči tlačítka (jako v kontrole výpisu).
    <div className={styles.archivePickerField}>
    <MatchingDropdown
      label={`Vybrat fakturu pro platbu ${payment.external_id}`}
      open={open}
      onOpenChange={(next) => { if (!disabled) setOpen(next); }}
      className={styles.invoicePicker}
      trigger={<span>{selected ? `${selected.invoice_number} · ${selected.counterparty_name} · zbývá ${new Intl.NumberFormat("cs-CZ", { style: "currency", currency: selected.currency }).format(remaining(selected))}` : "Vyberte fakturu…"}</span>}
    >
      {(close) => <>
        <label className={styles.pickerSearch}><Icon name="search" /><input aria-label="Hledat fakturu" maxLength={100} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Číslo, VS, odběratel nebo IČO" /></label>
        {loading && <p className={styles.hint} role="status">Načítáme faktury…</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.invoiceOptions} role="group" aria-label="Dostupné faktury">
          {items.map((invoice) => {
            const reasons = (invoice.match_reasons ?? []).filter((reason) => reason in REASONS);
            return <div key={invoice.id} className={styles.invoiceOption} data-invoice-option>
              <button type="button" aria-pressed={invoice.id === value} onClick={() => { setChosen(invoice); onChange(invoice.id); close(); }}>
                <span><strong>{invoice.variable_symbol && invoice.variable_symbol !== invoice.invoice_number ? `${invoice.invoice_number} · VS ${invoice.variable_symbol}` : invoice.invoice_number}</strong><small>{invoice.counterparty_name}</small>
                  {reasons.length > 0 && <span className={styles.matchReasons}>{reasons.map((reason) => <em key={reason}>{REASONS[reason]}</em>)}</span>}
                </span>
                {invoice.due_date && <time>{formatCzechDate(invoice.due_date)}</time>}
                <b><ExactMoney value={remaining(invoice)} currency={invoice.currency} /></b>
              </button>
            </div>;
          })}
          {!items.length && !loading && !error && <p className={styles.hint}>Žádná otevřená faktura ve stejné měně s dostatečným zůstatkem.</p>}
        </div>
      </>}
    </MatchingDropdown>
    </div>
  );
}
