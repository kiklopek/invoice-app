"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { minorUnits } from "@/lib/money";
import { defaultInvoiceQuery, invoiceFit, rankCandidates } from "@/lib/payment-review-model";
import { formatMoney, type Invoice, type PreviewEntry } from "./types";


/**
 * Výběr faktury přímo v kartě platby. Hledání je předvyplněné podle platby
 * (variabilní symbol, jinak jméno plátce); když nic nenajde, zkusí se další
 * vodítko a nakonec všechny otevřené faktury -- uživatel nikdy nezačíná
 * prázdným seznamem, dokud sám nehledá. U každé faktury je vidět, co
 * s platbou sedí.
 */
export function InvoicePicker({
  entry,
  selectedIds,
  amounts,
  invoiceById,
  disabled,
  onToggle,
  onAmount,
  onLoaded,
  onClose,
}: {
  entry: PreviewEntry;
  selectedIds: string[];
  amounts: Record<string, number>;
  invoiceById: Map<string, Invoice>;
  disabled: boolean;
  onToggle: (invoiceId: string, checked: boolean) => void;
  onAmount: (invoiceId: string, value: number) => void;
  onLoaded: (invoices: Invoice[]) => void;
  onClose: () => void;
}) {
  const fallbacks = useMemo(() => {
    const symbol = defaultInvoiceQuery({ variable_symbol: entry.variable_symbol, counterparty_name: null });
    const name = defaultInvoiceQuery({ variable_symbol: null, counterparty_name: entry.counterparty_name });
    return [...new Set([symbol, name].filter(Boolean)), ""];
  }, [entry.variable_symbol, entry.counterparty_name]);
  const [typed, setTyped] = useState<string | null>(null);
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const query = typed ?? fallbacks[fallbackIndex] ?? "";

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setFailed(false);
      apiFetch<{ invoices: Invoice[]; total: number }>(
        `/api/payments/invoice-candidates?q=${encodeURIComponent(query.trim())}&page=${page}`,
      )
        .then((data) => {
          if (!active) return;
          const list = data.invoices ?? [];
          onLoaded(list);
          // Nic nenašlo předvyplněné hledání: zkusit další vodítko.
          if (typed === null && page === 1 && list.length === 0 && fallbackIndex < fallbacks.length - 1) {
            setFallbackIndex((index) => index + 1);
            return;
          }
          setResults((current) => (page === 1 ? list : [...current, ...list]));
          setTotal(data.total ?? list.length);
          setLoading(false);
        })
        .catch(() => {
          if (!active) return;
          setFailed(true);
          setLoading(false);
        });
    }, typed === null ? 0 : 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // onLoaded is a fresh closure each render; results only depend on the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, page]);

  const selected = selectedIds.map((id) => invoiceById.get(id)).filter((invoice): invoice is Invoice => Boolean(invoice));
  // Vybrané faktury zůstávají nahoře, i když je aktuální hledání nenajde.
  const ranked = rankCandidates(entry, [...selected, ...results.filter((invoice) => !selectedIds.includes(invoice.id))]);
  const currency = entry.currency || "CZK";
  const payment = minorUnits(Number(entry.amount ?? 0));
  const allocated = selected.reduce((sum, invoice) => {
    const manual = amounts[invoice.id];
    const remaining = Math.max(0, minorUnits(Number(invoice.amount)) - minorUnits(Number(invoice.paid_amount)));
    return sum + (typeof manual === "number" && Number.isFinite(manual) && manual >= 0 ? minorUnits(manual) : remaining);
  }, 0);
  const difference = payment - allocated;
  const hint = typed !== null
    ? null
    : query && query === fallbacks[0] && entry.variable_symbol
      ? `Hledáme podle variabilního symbolu ${query}.`
      : query
        ? `Hledáme podle jména plátce „${query}“.`
        : "Platbě neodpovídá symbol ani jméno – ukazujeme všechny otevřené faktury, nejpodobnější nahoře.";

  return (
    <div className="invoice-picker" role="group" aria-label="Výběr faktury">
      <label className="invoice-picker-search">
        <span>Hledat fakturu</span>
        <input
          type="search"
          enterKeyHint="search"
          value={query}
          placeholder="Číslo faktury, odběratel nebo variabilní symbol"
          onChange={(event) => {
            setTyped(event.target.value);
            setPage(1);
          }}
        />
      </label>
      {hint && <p className="invoice-picker-hint">{hint}</p>}
      {failed ? (
        <p className="invoice-picker-empty" role="alert">Faktury se nepodařilo načíst. Zkuste hledat znovu.</p>
      ) : ranked.length === 0 && !loading ? (
        <p className="invoice-picker-empty">Žádná otevřená faktura neodpovídá hledání.</p>
      ) : (
        <ul className="invoice-picker-list" aria-busy={loading}>
          {ranked.map((invoice) => {
            const fit = invoiceFit(entry, invoice);
            const checked = selectedIds.includes(invoice.id);
            return (
              <li key={invoice.id}>
                <label className={`invoice-option${checked ? " is-selected" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => onToggle(invoice.id, event.target.checked)}
                  />
                  <span className="invoice-option-main">
                    <strong>Faktura {invoice.invoice_number}</strong>
                    <span className="invoice-option-customer" title={invoice.counterparty_name}>{invoice.counterparty_name}</span>
                  </span>
                  <span className="invoice-option-side">
                    <span className="invoice-option-amount">
                      zbývá <span className="money">{formatMoney(fit.remaining, invoice.currency)}</span>
                    </span>
                    {(fit.amount || fit.symbol) && (
                      <span className="invoice-option-fit">
                        {fit.symbol && <span>sedí symbol</span>}
                        {fit.amount && <span>sedí částka</span>}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {!failed && results.length < total && (
        <button type="button" className="btn secondary invoice-picker-more" disabled={loading} onClick={() => setPage((value) => value + 1)}>
          Zobrazit další faktury
        </button>
      )}
      {selected.length > 1 && (
        <div className="invoice-picker-amounts">
          <p>Kolik z platby připadá na kterou fakturu:</p>
          {selected.map((invoice) => {
            const remaining = Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount));
            return (
              <label className="gpc-allocation-field" key={invoice.id}>
                <span>Faktura {invoice.invoice_number}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  max={remaining}
                  disabled={disabled}
                  value={amounts[invoice.id] ?? remaining}
                  onChange={(event) => onAmount(invoice.id, Number(event.target.value))}
                />
              </label>
            );
          })}
        </div>
      )}
      <div className="invoice-picker-footer">
        <p className={`invoice-picker-balance ${selected.length === 0 ? "is-empty" : difference === 0 ? "is-ok" : "is-off"}`} aria-live="polite">
          {selected.length === 0
            ? "Zatím není vybraná žádná faktura."
            : difference === 0
              ? <>Vybráno <span className="money">{formatMoney(allocated / 100, currency)}</span> z <span className="money">{formatMoney(payment / 100, currency)}</span> ✓</>
              : difference > 0
                ? <>Chybí <span className="money">{formatMoney(difference / 100, currency)}</span> do výše platby</>
                : <>Vybráno o <span className="money">{formatMoney(-difference / 100, currency)}</span> víc, než je platba</>}
        </p>
        <button type="button" className="btn primary invoice-picker-done" onClick={onClose}>
          Hotovo
        </button>
      </div>
    </div>
  );
}
