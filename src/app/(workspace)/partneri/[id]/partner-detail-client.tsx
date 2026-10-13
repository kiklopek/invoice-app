"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { AppFrame } from "@/components/layout/app-shell";
import { FlagInvoiceModal, type FlagTarget } from "@/components/network/flag-invoice-modal";
import { NetworkActionsMenu } from "@/components/network/network-actions-menu";
import { FlagBadges, InvoiceStatusBadge, PartnerIdentity } from "@/components/network/network-ui";
import { useToast } from "@/components/toast";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { confirmAction } from "@/lib/confirm-action";
import { plural } from "@/lib/czech-plural";
import {
  behaviourLabel,
  describeNetPosition,
  FLAG_REASON_LABELS,
  formatCurrencyList,
  formatDate,
  formatMoney,
  hasOpenFlag,
  netPositions,
  openAmount,
  type NetworkFlag,
  type NetworkInvoice,
  type PartnerDetailPageData,
} from "@/lib/partner-network";
import { useInvalidateWorkspaceData } from "@/lib/workspace-cache";

type Side = "received" | "issued";

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof ApiRequestError || cause instanceof Error ? cause.message : fallback;
}

export function PartnerDetailClient({ id, initialData }: { id: string; initialData: PartnerDetailPageData }) {
  const router = useRouter();
  const { showToast } = useToast();
  const invalidate = useInvalidateWorkspaceData();
  const { data, error: loadError, mutate } = useSWR<PartnerDetailPageData>(`/api/partners/${id}`, {
    fallbackData: initialData,
    revalidateOnMount: false,
  });
  const detail = data ?? initialData;
  const partner = detail.partner;
  const positions = useMemo(() => netPositions(detail.balances), [detail.balances]);
  const [side, setSide] = useState<Side>(detail.received.some((invoice) => invoice.status !== "paid") || !detail.issued.length ? "received" : "issued");
  const [flagTarget, setFlagTarget] = useState<FlagTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (loadError instanceof Error) showToast({ variant: "error", message: loadError.message });
  }, [loadError, showToast]);

  async function refresh() {
    await mutate();
    invalidate();
  }

  async function decideFlag(invoice: NetworkInvoice, flag: NetworkFlag, decision: "resolved" | "rejected" | "withdrawn") {
    const what = flag.kind === "payment_claimed" ? "oznámení platby" : "rozpor";
    const confirmed = await confirmAction({
      title: decision === "withdrawn" ? `Stáhnout ${what} k faktuře ${invoice.invoice_number}?` : decision === "resolved" ? `Označit ${what} jako vyřešený?` : `Zamítnout ${what}?`,
      description: decision === "withdrawn"
        ? `${partner.name} uvidí, že jste připomínku stáhli.`
        : flag.kind === "payment_claimed" && decision === "resolved"
          ? "Tím se faktura za zaplacenou neoznačí. Úhradu potvrďte v detailu faktury nebo spárováním platby z výpisu."
          : `${partner.name} uvidí vaše rozhodnutí u faktury.`,
      confirmLabel: decision === "withdrawn" ? "Stáhnout" : decision === "resolved" ? "Vyřešeno" : "Zamítnout",
      confirmVariant: decision === "rejected" ? "danger" : "primary",
    });
    if (!confirmed) return;
    setBusy(flag.id);
    try {
      await apiFetch(`/api/partners/flags/${flag.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      showToast({ variant: "success", message: "Připomínka byla vyřízena." });
      await refresh();
    } catch (cause) {
      showToast({ variant: "error", message: errorMessage(cause, "Připomínku se nepodařilo vyřídit.") });
    } finally {
      setBusy(null);
    }
  }

  async function setShareHistory(share: boolean) {
    const confirmed = await confirmAction({
      title: share ? `Sdílet s firmou ${partner.name} i zaplacenou historii?` : "Přestat sdílet zaplacenou historii?",
      description: share
        ? `${partner.name} uvidí i faktury, které jste jí vystavili a byly zaplacené před propojením.`
        : "Partner dál uvidí otevřené faktury a faktury vystavené od propojení.",
      confirmLabel: share ? "Sdílet historii" : "Přestat sdílet",
      confirmVariant: "primary",
    });
    if (!confirmed) return;
    setBusy("share");
    try {
      await apiFetch(`/api/partners/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "share_history", share }),
      });
      showToast({ variant: "success", message: share ? "Historie se teď sdílí." : "Historie se už nesdílí." });
      await refresh();
    } catch (cause) {
      showToast({ variant: "error", message: errorMessage(cause, "Nastavení se nepodařilo uložit.") });
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    const confirmed = await confirmAction({
      title: `Zrušit propojení s firmou ${partner.name}?`,
      description: "Obě firmy okamžitě přestanou vidět faktury té druhé a otevřené připomínky se uzavřou. Vaše vlastní faktury zůstanou beze změny.",
      confirmLabel: "Zrušit propojení",
    });
    if (!confirmed) return;
    setBusy("revoke");
    try {
      await apiFetch(`/api/partners/${id}`, { method: "DELETE" });
      showToast({ variant: "success", message: `Propojení s firmou ${partner.name} bylo zrušeno.` });
      invalidate();
      router.replace("/partneri");
    } catch (cause) {
      showToast({ variant: "error", message: errorMessage(cause, "Propojení se nepodařilo zrušit.") });
      setBusy(null);
    }
  }

  const invoices = side === "received" ? detail.received : detail.issued;
  const openReceived = detail.received.filter((invoice) => invoice.status !== "paid");
  const openIssued = detail.issued.filter((invoice) => invoice.status !== "paid");
  const issuedFlags = detail.issued.reduce((sum, invoice) => sum + invoice.flags.filter((flag) => flag.status === "open").length, 0);
  const headline = positions.length ? positions.map((position) => describeNetPosition(position, partner.name)) : ["Vyrovnáno"];

  return (
    <AppFrame className="content section-page network-page partner-detail-page">
      <Link href="/partneri" className="back-link">← Zpět na partnery</Link>
      <header className="section-header detail-page-header">
        <div>
          <p>PARTNER V SÍTI</p>
          <h1>{partner.name}</h1>
          <span>IČO {partner.ico}{partner.dic ? ` · DIČ ${partner.dic}` : ""} · propojeno od {formatDate(detail.activated_at)}</span>
        </div>
        {detail.can_manage ? (
          <div className="section-actions">
            <button type="button" className="btn secondary" disabled={busy === "revoke"} onClick={revoke}>Zrušit propojení</button>
          </div>
        ) : null}
      </header>

      <section className="network-hero" aria-label="Vzájemná bilance">
        <div className="network-hero-net">
          <small>Čistá pozice</small>
          {headline.map((line) => <strong key={line}>{line}</strong>)}
          <p>Počítá se z otevřených faktur mezi vámi, zvlášť pro každou měnu. Jde o informaci, ne o zápočet.</p>
        </div>
        <div className="network-hero-split">
          <div>
            <small>Dluží vám</small>
            <strong>{formatCurrencyList(positions.map((position) => ({ currency: position.currency, amount: position.theyOwe })))}</strong>
            <span>{plural(openIssued.length, "otevřená faktura", "otevřené faktury", "otevřených faktur")}</span>
          </div>
          <div>
            <small>Dlužíte</small>
            <strong>{formatCurrencyList(positions.map((position) => ({ currency: position.currency, amount: position.weOwe })))}</strong>
            <span>{plural(openReceived.length, "otevřená faktura", "otevřené faktury", "otevřených faktur")}</span>
          </div>
        </div>
      </section>

      {issuedFlags ? (
        <div className="network-notice warning" role="status">
          <Icon name="alert" />
          <p><strong>{partner.name} má {plural(issuedFlags, "připomínku", "připomínky", "připomínek")} k vašim fakturám.</strong> Najdete je v záložce Vystavené. Upomínky se kvůli nim samy nezastaví – rozhodněte o nich vy.</p>
        </div>
      ) : null}

      <div className="network-detail-grid">
        <div>
          <div className="network-tabs" role="tablist" aria-label="Faktury mezi firmami">
            <button type="button" role="tab" id="partner-tab-received" aria-controls="partner-panel" aria-selected={side === "received"} onClick={() => setSide("received")}>
              Přijaté od partnera {detail.received.length ? <em>{detail.received.length}</em> : null}
            </button>
            <button type="button" role="tab" id="partner-tab-issued" aria-controls="partner-panel" aria-selected={side === "issued"} onClick={() => setSide("issued")}>
              Vystavené partnerovi {detail.issued.length ? <em className={issuedFlags ? "attention" : ""}>{detail.issued.length}</em> : null}
            </button>
          </div>
          <section id="partner-panel" role="tabpanel" aria-labelledby={side === "received" ? "partner-tab-received" : "partner-tab-issued"} className="page-panel network-panel">
            <header>
              <div>
                <small>{side === "received" ? "FAKTURY OD PARTNERA" : "VAŠE FAKTURY PARTNEROVI"}</small>
                <h2>{side === "received" ? `Co dlužíte firmě ${partner.name}` : `Co vám dluží ${partner.name}`}</h2>
                <p>{side === "received"
                  ? "Faktury vystavené na IČO vaší firmy. Pokud něco nesedí, pošlete rozpor; po zaplacení můžete platbu oznámit."
                  : "Faktury, které partner vidí ve Splatnu. Stav úhrady měníte jako obvykle v detailu faktury."}</p>
              </div>
            </header>
            {invoices.length ? (
              <div className="network-table">
                <table>
                  <thead>
                    <tr>
                      <th>Faktura</th>
                      <th className="network-col-secondary">Vystaveno</th>
                      <th>Splatnost</th>
                      <th>Částka</th>
                      <th>Zbývá</th>
                      <th>Stav</th>
                      <th><span className="sr-only">Akce</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td data-label="Faktura" className="network-cell-primary">
                          <strong>{invoice.invoice_number}</strong>
                          <small>{invoice.variable_symbol ? `VS ${invoice.variable_symbol}` : "Bez VS"}</small>
                          <FlagBadges flags={invoice.flags} currency={invoice.currency} />
                          {side === "issued" ? invoice.flags.filter((flag) => flag.status === "open" && flag.note).map((flag) => (
                            <small key={flag.id} className="network-flag-note">„{flag.note}“{flag.reason ? ` (${FLAG_REASON_LABELS[flag.reason]})` : ""}</small>
                          )) : null}
                        </td>
                        <td data-label="Vystaveno" className="network-col-secondary">{formatDate(invoice.issue_date)}</td>
                        <td data-label="Splatnost">{formatDate(invoice.due_date)}</td>
                        <td data-label="Částka" className="money">{formatMoney(Number(invoice.amount), invoice.currency, 2)}</td>
                        <td data-label="Zbývá" className="money">{invoice.status === "paid" ? "—" : formatMoney(openAmount(invoice), invoice.currency, 2)}</td>
                        <td data-label="Stav"><InvoiceStatusBadge status={invoice.status} /></td>
                        <td data-label="Akce" className="network-cell-actions">
                          <div className="network-row-actions">
                            <NetworkActionsMenu label={`Akce s fakturou ${invoice.invoice_number}`}>
                              {side === "received" ? (
                                <>
                                  <a href={`/api/partners/invoices/${invoice.id}/pdf`} target="_blank" rel="noopener noreferrer">Stáhnout PDF s QR platbou</a>
                                  {invoice.status !== "paid" && !hasOpenFlag(invoice, "payment_claimed") ? (
                                    <button type="button" onClick={() => setFlagTarget({ invoice, kind: "payment_claimed", partnerName: partner.name })}>Oznámit platbu</button>
                                  ) : null}
                                  {invoice.status !== "paid" && !hasOpenFlag(invoice, "disputed") ? (
                                    <button type="button" onClick={() => setFlagTarget({ invoice, kind: "disputed", partnerName: partner.name })}>Rozporovat fakturu</button>
                                  ) : null}
                                  {invoice.flags.filter((flag) => flag.status === "open").map((flag) => (
                                    <button key={flag.id} type="button" disabled={busy === flag.id} onClick={() => decideFlag(invoice, flag, "withdrawn")}>
                                      Stáhnout {flag.kind === "payment_claimed" ? "oznámení platby" : "rozpor"}
                                    </button>
                                  ))}
                                </>
                              ) : (
                                <>
                                  <Link href={`/invoices/${invoice.id}`}>Otevřít detail faktury</Link>
                                  {invoice.flags.filter((flag) => flag.status === "open").map((flag) => (
                                    <span key={flag.id}>
                                      <button type="button" disabled={busy === flag.id} onClick={() => decideFlag(invoice, flag, "resolved")}>
                                        {flag.kind === "payment_claimed" ? "Platba ověřena" : "Rozpor vyřešen"}
                                      </button>
                                      <button type="button" disabled={busy === flag.id} onClick={() => decideFlag(invoice, flag, "rejected")}>
                                        Zamítnout {flag.kind === "payment_claimed" ? "oznámení platby" : "rozpor"}
                                      </button>
                                    </span>
                                  ))}
                                </>
                              )}
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
                <span><Icon name={side === "received" ? "inbox" : "invoice"} /></span>
                <strong>{side === "received" ? "Od partnera zatím žádné faktury" : "Partnerovi zatím nic nesdílíte"}</strong>
                <p>{side === "received"
                  ? `Faktury, které vám ${partner.name} vystaví ve Splatnu na IČO vaší firmy, se tu objeví automaticky.`
                  : `Faktury, které vystavíte na IČO ${partner.ico}, se tu objeví automaticky.`}</p>
              </div>
            )}
          </section>
        </div>

        <aside>
          <section className="page-panel network-panel">
            <header><div><small>PROFIL FIRMY</small><h2>Údaje partnera</h2></div></header>
            <div className="network-panel-body">
              <PartnerIdentity name={partner.name} ico={partner.ico} logo={partner.logo_path} />
              <dl className="network-facts">
                {partner.address ? <div><dt>Sídlo</dt><dd>{partner.address}</dd></div> : null}
                {partner.email ? <div><dt>E-mail</dt><dd>{partner.email}</dd></div> : null}
                {partner.phone ? <div><dt>Telefon</dt><dd>{partner.phone}</dd></div> : null}
                {partner.bank_account_czk ? <div><dt>Účet CZK</dt><dd>{partner.bank_account_czk}</dd></div> : null}
                {partner.bank_account_eur ? <div><dt>Účet EUR</dt><dd>{partner.bank_account_eur}</dd></div> : null}
              </dl>
              <p className="network-muted">Platební údaje ověřujte vždy podle faktury. Změnu účtu si potvrďte u partnera telefonicky.</p>
            </div>
          </section>

          <section className="page-panel network-panel">
            <header><div><small>PLATEBNÍ MORÁLKA</small><h2>Jak se platí</h2><p>Zaplacené faktury za posledních 12 měsíců.</p></div></header>
            <div className="network-panel-body">
              <dl className="network-facts">
                <div><dt>{partner.name}</dt><dd>{behaviourLabel(detail.behaviour.they_pay)}</dd></div>
                <div><dt>Vaše firma</dt><dd>{behaviourLabel(detail.behaviour.we_pay)}</dd></div>
              </dl>
            </div>
          </section>

          <section className="page-panel network-panel">
            <header><div><small>SDÍLENÍ</small><h2>Co partner vidí</h2></div></header>
            <div className="network-panel-body">
              <p className="network-muted">Partner vidí faktury, které jste mu vystavili od propojení, a faktury, které byly v okamžiku propojení nezaplacené. Nikdy nevidí vaše poznámky, upomínky, výpisy ani faktury jiným firmám.</p>
              {detail.can_manage ? (
                <label className="network-switch">
                  <input type="checkbox" checked={detail.share_history.mine} disabled={busy === "share"} onChange={(event) => void setShareHistory(event.target.checked)} />
                  <span>Sdílet i zaplacenou historii před propojením</span>
                </label>
              ) : (
                <p className="network-muted">Historie: {detail.share_history.mine ? "sdílí se" : "nesdílí se"} (mění administrátor).</p>
              )}
              <p className="network-muted">{partner.name} {detail.share_history.theirs ? "s vámi sdílí i svou zaplacenou historii." : "s vámi zaplacenou historii před propojením nesdílí."}</p>
            </div>
          </section>
        </aside>
      </div>

      <FlagInvoiceModal
        key={flagTarget ? `${flagTarget.invoice.id}:${flagTarget.kind}` : "none"}
        target={flagTarget}
        onClose={() => setFlagTarget(null)}
        onSaved={async (message) => {
          setFlagTarget(null);
          showToast({ variant: "success", message });
          await refresh();
        }}
      />
    </AppFrame>
  );
}
