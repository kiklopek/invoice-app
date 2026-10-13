"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { AppFrame } from "@/components/layout/app-shell";
import { FlagInvoiceModal, type FlagTarget } from "@/components/network/flag-invoice-modal";
import { NetworkActionsMenu } from "@/components/network/network-actions-menu";
import { FlagBadges, InvoiceStatusBadge, PartnerIdentity } from "@/components/network/network-ui";
import { useToast } from "@/components/toast";
import { plural } from "@/lib/czech-plural";
import {
  formatCurrencyList,
  formatDate,
  formatMoney,
  hasOpenFlag,
  openAmount,
  type ReceivedInvoice,
  type ReceivedInvoicesPageData,
} from "@/lib/partner-network";
import { useInvalidateWorkspaceData } from "@/lib/workspace-cache";

type Filter = "open" | "overdue" | "flagged" | "paid" | "all";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "open", label: "K úhradě" },
  { key: "overdue", label: "Po splatnosti" },
  { key: "flagged", label: "S připomínkou" },
  { key: "paid", label: "Zaplacené" },
  { key: "all", label: "Vše" },
];

function matches(invoice: ReceivedInvoice, filter: Filter) {
  if (filter === "open") return invoice.status !== "paid";
  if (filter === "overdue") return invoice.status === "overdue";
  if (filter === "flagged") return hasOpenFlag(invoice);
  if (filter === "paid") return invoice.status === "paid";
  return true;
}

function totalsByCurrency(invoices: ReceivedInvoice[]) {
  const totals = new Map<string, number>();
  for (const invoice of invoices) {
    if (invoice.status === "paid") continue;
    totals.set(invoice.currency, (totals.get(invoice.currency) ?? 0) + openAmount(invoice));
  }
  return [...totals.entries()].map(([currency, amount]) => ({ currency, amount }));
}

export function ReceivedInvoicesClient({ initialData }: { initialData: ReceivedInvoicesPageData }) {
  const { showToast } = useToast();
  const invalidate = useInvalidateWorkspaceData();
  const { data, error: loadError, mutate } = useSWR<ReceivedInvoicesPageData>("/api/partners/received", {
    fallbackData: initialData,
    revalidateOnMount: false,
  });
  const invoices = (data ?? initialData).invoices;
  const [filter, setFilter] = useState<Filter>("open");
  const [flagTarget, setFlagTarget] = useState<FlagTarget | null>(null);

  useEffect(() => {
    if (loadError instanceof Error) showToast({ variant: "error", message: loadError.message });
  }, [loadError, showToast]);

  const visible = useMemo(() => invoices.filter((invoice) => matches(invoice, filter)), [invoices, filter]);
  const openTotals = useMemo(() => totalsByCurrency(invoices), [invoices]);
  const overdueTotals = useMemo(() => totalsByCurrency(invoices.filter((invoice) => invoice.status === "overdue")), [invoices]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((item) => [item.key, invoices.filter((invoice) => matches(invoice, item.key)).length])) as Record<Filter, number>, [invoices]);

  return (
    <AppFrame className="content section-page network-page received-invoices-page">
      <Link href="/partneri" className="back-link">← Zpět na partnery</Link>
      <header className="section-header">
        <div>
          <p>SPLATNO SÍŤ</p>
          <h1>Přijaté faktury</h1>
          <span>Faktury, které vám vystavili propojení partneři ve Splatnu. Chodí sem samy, bez přepisování a bez e-mailových příloh.</span>
        </div>
      </header>

      <section className="network-summary" aria-label="Souhrn přijatých faktur">
        <article className="we-owe">
          <span><Icon name="inbox" /></span>
          <div>
            <small>K úhradě celkem</small>
            <strong className="network-money">{formatCurrencyList(openTotals)}</strong>
            <p>{plural(counts.open, "otevřená faktura", "otevřené faktury", "otevřených faktur")}</p>
          </div>
        </article>
        <article>
          <span><Icon name="clock" /></span>
          <div>
            <small>Po splatnosti</small>
            <strong className="network-money">{formatCurrencyList(overdueTotals)}</strong>
            <p>{counts.overdue ? plural(counts.overdue, "faktura", "faktury", "faktur") : "Nic po splatnosti"}</p>
          </div>
        </article>
        <article>
          <span><Icon name="alert" /></span>
          <div>
            <small>Vaše připomínky</small>
            <strong>{counts.flagged}</strong>
            <p>Rozpory a oznámené platby čekající na vystavitele</p>
          </div>
        </article>
      </section>

      <div className="network-tabs" role="tablist" aria-label="Filtr přijatých faktur">
        {FILTERS.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={filter === item.key} aria-controls="received-panel" onClick={() => setFilter(item.key)}>
            {item.label}{counts[item.key] ? <em className={item.key === "overdue" ? "attention" : ""}>{counts[item.key]}</em> : null}
          </button>
        ))}
      </div>

      <section id="received-panel" role="tabpanel" className="page-panel network-panel">
        {visible.length ? (
          <div className="network-table">
            <table>
              <thead>
                <tr>
                  <th>Dodavatel</th>
                  <th>Faktura</th>
                  <th>Splatnost</th>
                  <th>Zbývá</th>
                  <th>Stav</th>
                  <th><span className="sr-only">Akce</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((invoice) => (
                  <tr key={invoice.id}>
                    <td data-label="Dodavatel" className="network-cell-primary">
                      <PartnerIdentity name={invoice.partner.name} ico={invoice.partner.ico} logo={invoice.partner.logo_path} href={`/partneri/${invoice.connection_id}`} />
                    </td>
                    <td data-label="Faktura">
                      <strong>{invoice.invoice_number}</strong>
                      <small>{invoice.variable_symbol ? `VS ${invoice.variable_symbol} · ` : ""}{formatMoney(Number(invoice.amount), invoice.currency, 2)}</small>
                      <FlagBadges flags={invoice.flags} currency={invoice.currency} />
                    </td>
                    <td data-label="Splatnost">{formatDate(invoice.due_date)}</td>
                    <td data-label="Zbývá" className="money">{invoice.status === "paid" ? "—" : formatMoney(openAmount(invoice), invoice.currency, 2)}</td>
                    <td data-label="Stav"><InvoiceStatusBadge status={invoice.status} /></td>
                    <td data-label="Akce" className="network-cell-actions">
                      <div className="network-row-actions">
                        <NetworkActionsMenu label={`Akce s fakturou ${invoice.invoice_number}`}>
                          <a href={`/api/partners/invoices/${invoice.id}/pdf`} target="_blank" rel="noopener noreferrer">Stáhnout PDF s QR platbou</a>
                          {invoice.status !== "paid" && !hasOpenFlag(invoice, "payment_claimed") ? (
                            <button type="button" onClick={() => setFlagTarget({ invoice, kind: "payment_claimed", partnerName: invoice.partner.name })}>Oznámit platbu</button>
                          ) : null}
                          {invoice.status !== "paid" && !hasOpenFlag(invoice, "disputed") ? (
                            <button type="button" onClick={() => setFlagTarget({ invoice, kind: "disputed", partnerName: invoice.partner.name })}>Rozporovat fakturu</button>
                          ) : null}
                          <Link href={`/partneri/${invoice.connection_id}`}>Detail partnera</Link>
                        </NetworkActionsMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="payments-empty-state">
            <span><Icon name="inbox" /></span>
            <strong>{invoices.length ? "V tomto filtru nic není" : "Zatím žádné přijaté faktury"}</strong>
            <p>{invoices.length
              ? "Zkuste jiný filtr."
              : "Jakmile se propojíte s dodavatelem, který používá Splatno, jeho faktury na IČO vaší firmy se tu objeví automaticky."}</p>
            {invoices.length
              ? <button type="button" className="btn secondary" onClick={() => setFilter("all")}>Zobrazit vše</button>
              : <Link href="/partneri">Přejít na partnery →</Link>}
          </div>
        )}
      </section>

      <FlagInvoiceModal
        key={flagTarget ? `${flagTarget.invoice.id}:${flagTarget.kind}` : "none"}
        target={flagTarget}
        onClose={() => setFlagTarget(null)}
        onSaved={async (message) => {
          setFlagTarget(null);
          showToast({ variant: "success", message });
          await mutate();
          invalidate();
        }}
      />
    </AppFrame>
  );
}
