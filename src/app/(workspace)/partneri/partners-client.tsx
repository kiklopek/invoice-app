"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { AppFrame } from "@/components/layout/app-shell";
import { NetPills, PartnerIdentity } from "@/components/network/network-ui";
import { useToast } from "@/components/toast";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { confirmAction } from "@/lib/confirm-action";
import { plural } from "@/lib/czech-plural";
import {
  formatCurrencyList,
  formatDate,
  formatMoney,
  isLookupIco,
  networkTotals,
  normalizeIcoInput,
  type InviteCandidate,
  type LookupResult,
  type NetworkConnection,
  type NetworkSuggestion,
  type PartnersPageData,
} from "@/lib/partner-network";
import { useInvalidateWorkspaceData } from "@/lib/workspace-cache";

type Tab = "partners" | "requests" | "suggestions" | "invite";

const RELATION_LABELS: Record<NetworkSuggestion["relation"], string> = {
  customer: "Fakturujete jim",
  supplier: "Fakturují vám",
  both: "Fakturujete si navzájem",
};

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof ApiRequestError || cause instanceof Error ? cause.message : fallback;
}

export function PartnersClient({ initialData }: { initialData: PartnersPageData }) {
  const { data, error: loadError, mutate } = useSWR<PartnersPageData>("/api/partners", {
    fallbackData: initialData,
    revalidateOnMount: false,
  });
  const { showToast } = useToast();
  const invalidate = useInvalidateWorkspaceData();
  const overview = data ?? initialData;
  const canManage = overview.can_manage;

  useEffect(() => {
    if (loadError instanceof Error) showToast({ variant: "error", message: loadError.message });
  }, [loadError, showToast]);

  const active = useMemo(() => overview.connections.filter((connection) => connection.status === "active"), [overview.connections]);
  const incoming = useMemo(() => overview.connections.filter((connection) => connection.status === "pending" && connection.direction === "incoming"), [overview.connections]);
  const outgoing = useMemo(() => overview.connections.filter((connection) => connection.status === "pending" && connection.direction === "outgoing"), [overview.connections]);
  const totals = useMemo(() => networkTotals(overview.connections), [overview.connections]);
  const openFlags = active.reduce((sum, connection) => sum + (Number(connection.open_flags) || 0), 0);

  const [tab, setTab] = useState<Tab>(incoming.length && !active.length ? "requests" : "partners");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    await mutate();
    invalidate();
  }

  async function respond(connection: NetworkConnection, accept: boolean) {
    const name = connection.partner.name;
    const preview = connection.preview;
    const confirmed = await confirmAction(accept
      ? {
        title: `Propojit se s firmou ${name}?`,
        description: preview && preview.open_count > 0
          ? `${name} uvidí ${plural(preview.open_count, "vaši otevřenou fakturu", "vaše otevřené faktury", "vašich otevřených faktur")} na své IČO (${formatCurrencyList(Object.entries(preview.open_totals).map(([currency, amount]) => ({ currency, amount: Number(amount) })))}) a všechny, které jí vystavíte. Vy uvidíte faktury, které vystavuje ona vám. Propojení můžete kdykoli zrušit.`
          : `${name} uvidí faktury, které jí vystavíte, a vy uvidíte faktury, které vystavuje vám. Propojení můžete kdykoli zrušit.`,
        confirmLabel: "Přijmout propojení",
        confirmVariant: "primary",
      }
      : {
        title: `Odmítnout žádost firmy ${name}?`,
        description: "Firma se o odmítnutí dozví. Znovu vás může požádat nejdříve za 30 dní.",
        confirmLabel: "Odmítnout",
      });
    if (!confirmed) return;
    setBusy(connection.id);
    try {
      await apiFetch(`/api/partners/${connection.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: accept ? "accept" : "decline" }),
      });
      showToast({ variant: "success", message: accept ? `Jste propojení s firmou ${name}.` : "Žádost byla odmítnuta." });
      if (accept) setTab("partners");
      await refresh();
    } catch (cause) {
      showToast({ variant: "error", message: errorMessage(cause, "Žádost se nepodařilo vyřídit.") });
    } finally {
      setBusy(null);
    }
  }

  async function cancelRequest(connection: NetworkConnection) {
    const confirmed = await confirmAction({
      title: `Zrušit žádost pro ${connection.partner.name}?`,
      description: "Žádost zmizí a firma ji už nebude moci přijmout.",
      confirmLabel: "Zrušit žádost",
    });
    if (!confirmed) return;
    setBusy(connection.id);
    try {
      await apiFetch(`/api/partners/${connection.id}`, { method: "DELETE" });
      showToast({ variant: "success", message: "Žádost byla zrušena." });
      await refresh();
    } catch (cause) {
      showToast({ variant: "error", message: errorMessage(cause, "Žádost se nepodařilo zrušit.") });
    } finally {
      setBusy(null);
    }
  }

  async function connectSuggestion(suggestion: NetworkSuggestion) {
    const confirmed = await confirmAction({
      title: `Poslat žádost o propojení firmě ${suggestion.partner.name}?`,
      description: "Administrátoři firmy uvidí název a IČO vaší firmy a váš e-mail. Faktury se začnou sdílet až po přijetí.",
      confirmLabel: "Poslat žádost",
      confirmVariant: "primary",
    });
    if (!confirmed) return;
    setBusy(suggestion.partner.id);
    try {
      await apiFetch("/api/partners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ico: suggestion.partner.ico, origin: "suggestion" }),
      });
      showToast({ variant: "success", message: `Žádost pro ${suggestion.partner.name} byla odeslána.` });
      await refresh();
    } catch (cause) {
      showToast({ variant: "error", message: errorMessage(cause, "Žádost se nepodařilo odeslat.") });
    } finally {
      setBusy(null);
    }
  }

  async function invite(candidate: { ico: string; name: string }, email: string) {
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      showToast({ variant: "error", message: "Zadejte platnou e-mailovou adresu." });
      return false;
    }
    const confirmed = await confirmAction({
      title: `Odeslat pozvánku firmě ${candidate.name}?`,
      description: `Na adresu ${clean} odejde 1 e-mail jménem vaší firmy s odkazem k propojení ve Splatnu. Připomenout ho půjde nejdříve za 7 dní, nejvýše jednou.`,
      confirmLabel: "Odeslat pozvánku",
      confirmVariant: "primary",
    });
    if (!confirmed) return false;
    setBusy(`invite:${candidate.ico}`);
    try {
      await apiFetch("/api/partners/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ico: candidate.ico, email: clean }),
      });
      showToast({ variant: "success", message: `Pozvánka odešla na ${clean}.` });
      await refresh();
      return true;
    } catch (cause) {
      showToast({ variant: "error", message: errorMessage(cause, "Pozvánku se nepodařilo odeslat.") });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const tabs: Array<{ key: Tab; label: string; count?: number; attention?: boolean }> = [
    { key: "partners", label: "Partneři", count: active.length },
    { key: "requests", label: "Žádosti", count: incoming.length + outgoing.length, attention: incoming.length > 0 },
    { key: "suggestions", label: "Návrhy", count: overview.suggestions.length },
    { key: "invite", label: "Pozvat odběratele", count: overview.invite_candidates.length },
  ];

  return (
    <AppFrame className="content section-page network-page partners-page">
      <header className="section-header">
        <div>
          <p>SPLATNO SÍŤ</p>
          <h1>Partneři</h1>
          <span>Firmy, se kterými jste propojení. Vidíte faktury mezi vámi, kdo komu kolik dluží a jak kdo platí. Žádné příspěvky, jen faktury.</span>
        </div>
        <div className="section-actions">
          <Link href="/partneri/prijate" className="btn secondary"><Icon name="inbox" />&nbsp;Přijaté faktury</Link>
          {canManage ? (
            <button type="button" className="btn primary" onClick={() => setAdding((open) => !open)} aria-expanded={adding}>
              <Icon name="plus" />&nbsp;Přidat partnera
            </button>
          ) : null}
        </div>
      </header>

      {!overview.me.network_ready ? (
        <div className="network-notice danger" role="alert">
          <Icon name="alert" />
          <p>IČO vaší firmy ({overview.me.ico}) je ve Splatnu evidované u více firem. Než se budete moci propojit, kontaktujte prosím podporu – nic se tiše nepřiřadí.</p>
        </div>
      ) : null}

      {canManage && adding ? (
        <AddPartner
          onDone={async (message) => {
            if (message) showToast({ variant: "success", message });
            await refresh();
          }}
          onInvite={invite}
          onError={(message) => showToast({ variant: "error", message })}
          onShowRequests={() => { setAdding(false); setTab("requests"); }}
        />
      ) : null}

      <section className="network-summary" aria-label="Souhrn sítě">
        <article className="owed-to-us">
          <span><Icon name="arrow-left" /></span>
          <div>
            <small>Partneři dluží vám</small>
            <strong className="network-money">{formatCurrencyList(totals.map((total) => ({ currency: total.currency, amount: total.they_owe })))}</strong>
            <p>{totals.some((total) => total.they_overdue > 0) ? `Po splatnosti ${formatCurrencyList(totals.map((total) => ({ currency: total.currency, amount: total.they_overdue })))}` : "Nic po splatnosti"}</p>
          </div>
        </article>
        <article className="we-owe">
          <span><Icon name="arrow-right" /></span>
          <div>
            <small>Vy dlužíte partnerům</small>
            <strong className="network-money">{formatCurrencyList(totals.map((total) => ({ currency: total.currency, amount: total.we_owe })))}</strong>
            <p>{totals.some((total) => total.we_overdue > 0) ? `Po splatnosti ${formatCurrencyList(totals.map((total) => ({ currency: total.currency, amount: total.we_overdue })))}` : "Nic po splatnosti"}</p>
          </div>
        </article>
        <article>
          <span><Icon name="network" /></span>
          <div>
            <small>Síť</small>
            <strong>{plural(active.length, "partner", "partneři", "partnerů")}</strong>
            <p>
              {incoming.length ? `${plural(incoming.length, "nová žádost", "nové žádosti", "nových žádostí")} · ` : ""}
              {openFlags ? `${plural(openFlags, "připomínka", "připomínky", "připomínek")} k vašim fakturám` : "Bez otevřených připomínek"}
            </p>
          </div>
        </article>
      </section>

      <div className="network-tabs" role="tablist" aria-label="Části sítě">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`network-tab-${item.key}`}
            aria-controls={`network-panel-${item.key}`}
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
          >
            {item.label}
            {item.count ? <em className={item.attention ? "attention" : ""}>{item.count}</em> : null}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`network-panel-${tab}`} aria-labelledby={`network-tab-${tab}`}>
        {tab === "partners" ? (
          <PartnersTable connections={active} canManage={canManage} onAdd={() => setAdding(true)} onShowSuggestions={() => setTab("suggestions")} hasSuggestions={overview.suggestions.length > 0} />
        ) : null}

        {tab === "requests" ? (
          <section className="page-panel network-panel">
            <header>
              <div>
                <small>ŽÁDOSTI O PROPOJENÍ</small>
                <h2>Čekající žádosti</h2>
                <p>Faktury se začnou sdílet až po přijetí. Přijmout nebo odmítnout může administrátor firmy.</p>
              </div>
            </header>
            <div className="network-panel-body">
              {incoming.length || outgoing.length ? (
                <div className="network-cards">
                  {incoming.map((connection) => (
                    <article key={connection.id} className="network-card incoming">
                      <PartnerIdentity name={connection.partner.name} ico={connection.partner.ico} logo={connection.partner.logo_path} detail={`žádost ${formatDate(connection.created_at)}`} />
                      {connection.message ? <blockquote>{connection.message}</blockquote> : null}
                      {connection.requested_by_email ? (
                        <p>Odeslal(a) <b>{connection.requested_by_email}</b></p>
                      ) : null}
                      {connection.preview?.email_domain_match === true ? (
                        <span className="network-check ok"><Icon name="check" />E-mail odpovídá kontaktu z vašich faktur pro tuto firmu.</span>
                      ) : connection.preview?.email_domain_match === false ? (
                        <span className="network-check warn"><Icon name="alert" />E-mail neodpovídá kontaktu z vašich faktur. Ověřte si žádost u firmy, než ji přijmete.</span>
                      ) : null}
                      <p>
                        {connection.preview && connection.preview.open_count > 0
                          ? `Po přijetí firma uvidí ${plural(connection.preview.open_count, "vaši otevřenou fakturu", "vaše otevřené faktury", "vašich otevřených faktur")} na své IČO a nové faktury, které jí vystavíte.`
                          : "Po přijetí firma uvidí faktury, které jí vystavíte, a vy faktury, které vystaví vám."}
                      </p>
                      {canManage ? (
                        <div className="network-card-actions">
                          <button type="button" className="btn primary" disabled={busy === connection.id || !overview.me.network_ready} onClick={() => respond(connection, true)}>Přijmout</button>
                          <button type="button" className="btn secondary" disabled={busy === connection.id} onClick={() => respond(connection, false)}>Odmítnout</button>
                        </div>
                      ) : <p>Žádost vyřídí administrátor vaší firmy.</p>}
                    </article>
                  ))}
                  {outgoing.map((connection) => (
                    <article key={connection.id} className="network-card">
                      <PartnerIdentity name={connection.partner.name} ico={connection.partner.ico} logo={connection.partner.logo_path} detail={`odesláno ${formatDate(connection.created_at)}`} />
                      <p>Čeká na přijetí druhou stranou.</p>
                      {canManage ? (
                        <div className="network-card-actions">
                          <button type="button" className="btn secondary" disabled={busy === connection.id} onClick={() => cancelRequest(connection)}>Zrušit žádost</button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="payments-empty-state">
                  <span><Icon name="network" /></span>
                  <strong>Žádné čekající žádosti</strong>
                  <p>Až vám jiná firma pošle žádost o propojení, objeví se tady. Sami můžete poslat žádost tlačítkem Přidat partnera.</p>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {tab === "suggestions" ? (
          <section className="page-panel network-panel">
            <header>
              <div>
                <small>NÁVRHY</small>
                <h2>Obchodujete spolu a jsou na Splatnu</h2>
                <p>Firmy, kterým fakturujete nebo které fakturují vám, a už Splatno používají.</p>
              </div>
            </header>
            <div className="network-panel-body">
              {overview.suggestions.length ? (
                <div className="network-cards">
                  {overview.suggestions.map((suggestion) => (
                    <article key={suggestion.partner.id} className="network-card">
                      <PartnerIdentity name={suggestion.partner.name} ico={suggestion.partner.ico} logo={suggestion.partner.logo_path} />
                      <p>{RELATION_LABELS[suggestion.relation]} · {plural(Number(suggestion.invoice_count), "faktura", "faktury", "faktur")}</p>
                      {canManage ? (
                        <div className="network-card-actions">
                          <button type="button" className="btn primary" disabled={busy === suggestion.partner.id || !overview.me.network_ready} onClick={() => connectSuggestion(suggestion)}>Poslat žádost</button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="payments-empty-state">
                  <span><Icon name="users" /></span>
                  <strong>Zatím žádné návrhy</strong>
                  <p>Návrhy se objeví, jakmile Splatno začne používat firma, se kterou si fakturujete. Odběratele můžete pozvat v záložce Pozvat odběratele.</p>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {tab === "invite" ? (
          <InviteCandidates
            candidates={overview.invite_candidates}
            invitations={overview.invitations}
            canManage={canManage}
            busy={busy}
            onInvite={invite}
          />
        ) : null}
      </div>
    </AppFrame>
  );
}

function PartnersTable({ connections, canManage, onAdd, onShowSuggestions, hasSuggestions }: {
  connections: NetworkConnection[];
  canManage: boolean;
  onAdd: () => void;
  onShowSuggestions: () => void;
  hasSuggestions: boolean;
}) {
  return (
    <section className="page-panel network-panel">
      <header>
        <div>
          <small>PROPOJENÉ FIRMY</small>
          <h2>Vzájemné bilance</h2>
          <p>Částky jsou zvlášť pro každou měnu. Kliknutím otevřete faktury mezi vámi.</p>
        </div>
      </header>
      {connections.length ? (
        <div className="network-table">
          <table>
            <thead>
              <tr>
                <th>Partner</th>
                <th>Dluží vám</th>
                <th>Dlužíte</th>
                <th>Čistá pozice</th>
                <th className="network-col-secondary">Připomínky</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((connection) => (
                <tr key={connection.id}>
                  <td data-label="Partner" className="network-cell-primary">
                    <PartnerIdentity
                      name={connection.partner.name}
                      ico={connection.partner.ico}
                      logo={connection.partner.logo_path}
                      detail={connection.activated_at ? `od ${formatDate(connection.activated_at)}` : null}
                      href={`/partneri/${connection.id}`}
                    />
                  </td>
                  <td data-label="Dluží vám" className="money">
                    {formatCurrencyList(connection.balances.map((balance) => ({ currency: balance.currency, amount: Number(balance.they_owe) })))}
                    {connection.balances.some((balance) => Number(balance.they_overdue) > 0)
                      ? <small className="red-text">po splatnosti {formatCurrencyList(connection.balances.map((balance) => ({ currency: balance.currency, amount: Number(balance.they_overdue) })))}</small>
                      : null}
                  </td>
                  <td data-label="Dlužíte" className="money">
                    {formatCurrencyList(connection.balances.map((balance) => ({ currency: balance.currency, amount: Number(balance.we_owe) })))}
                    {connection.balances.some((balance) => Number(balance.we_overdue) > 0)
                      ? <small className="red-text">po splatnosti {formatCurrencyList(connection.balances.map((balance) => ({ currency: balance.currency, amount: Number(balance.we_overdue) })))}</small>
                      : null}
                  </td>
                  <td data-label="Čistá pozice"><NetPills balances={connection.balances} /></td>
                  <td data-label="Připomínky" className="network-col-secondary">
                    {Number(connection.open_flags) > 0
                      ? <span className="flag-badge"><Icon name="alert" />{plural(Number(connection.open_flags), "otevřená", "otevřené", "otevřených")}</span>
                      : <span className="muted-text">Žádné</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="payments-empty-state">
          <span><Icon name="network" /></span>
          <strong>Zatím žádní partneři</strong>
          <p>Propojte se s firmami, se kterými obchodujete. Uvidíte pak na jednom místě, kdo komu kolik dluží, a faktury od nich vám budou chodit rovnou sem.</p>
          {canManage ? (
            <div className="network-card-actions">
              <button type="button" className="btn primary" onClick={onAdd}>Přidat partnera</button>
              {hasSuggestions ? <button type="button" className="btn secondary" onClick={onShowSuggestions}>Zobrazit návrhy</button> : null}
            </div>
          ) : <p>Partnery přidává administrátor vaší firmy.</p>}
        </div>
      )}
    </section>
  );
}

function AddPartner({ onDone, onInvite, onError, onShowRequests }: {
  onDone: (message?: string) => Promise<void>;
  onInvite: (candidate: { ico: string; name: string }, email: string) => Promise<boolean>;
  onError: (message: string) => void;
  onShowRequests: () => void;
}) {
  const fieldId = useId();
  const [ico, setIco] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const clean = normalizeIcoInput(ico);
    if (!isLookupIco(clean)) {
      setResult({ state: "invalid_ico" });
      return;
    }
    setSearching(true);
    try {
      setResult(await apiFetch<LookupResult>(`/api/partners/lookup?ico=${clean}`));
    } catch (cause) {
      onError(errorMessage(cause, "Firmu se nepodařilo vyhledat."));
    } finally {
      setSearching(false);
    }
  }

  async function sendRequest(partnerName: string, partnerIco: string) {
    const confirmed = await confirmAction({
      title: `Poslat žádost o propojení firmě ${partnerName}?`,
      description: "Administrátoři firmy uvidí název a IČO vaší firmy, váš e-mail a zprávu. Faktury se začnou sdílet až po přijetí.",
      confirmLabel: "Poslat žádost",
      confirmVariant: "primary",
    });
    if (!confirmed) return;
    setSending(true);
    try {
      const response = await apiFetch<{ status: string }>("/api/partners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ico: partnerIco, message: message.trim() || null, origin: "search" }),
      });
      setResult(null);
      setIco("");
      setMessage("");
      await onDone(response.status === "active"
        ? `${partnerName} vás už žádala o propojení – teď jste propojení.`
        : `Žádost pro ${partnerName} byla odeslána.`);
    } catch (cause) {
      onError(errorMessage(cause, "Žádost se nepodařilo odeslat."));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="page-panel network-panel network-add" aria-labelledby={`${fieldId}-title`}>
      <header>
        <div>
          <small>NOVÝ PARTNER</small>
          <h2 id={`${fieldId}-title`}>Najít firmu podle IČO</h2>
          <p>Firmu, která už Splatno používá, požádáte o propojení. Firmu, která ho nepoužívá, můžete pozvat e-mailem.</p>
        </div>
      </header>
      <div className="network-panel-body network-add">
        <form className="network-add-search" onSubmit={search}>
          <label className="network-field" htmlFor={`${fieldId}-ico`}>
            <span>IČO firmy</span>
            <input
              id={`${fieldId}-ico`}
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="search"
              maxLength={12}
              placeholder="např. 27082440"
              value={ico}
              onChange={(event) => { setIco(event.target.value); setResult(null); }}
            />
          </label>
          <button type="submit" className="btn primary" disabled={searching || normalizeIcoInput(ico).length !== 8}>
            {searching ? "Hledám…" : "Vyhledat"}
          </button>
        </form>

        {result ? (
          <div className="network-add-result" role="status">
            {result.state === "invalid_ico" ? <p className="network-muted">Zadejte platné IČO – 8 číslic s kontrolní číslicí.</p> : null}
            {result.state === "self" ? <p className="network-muted">To je IČO vaší firmy.</p> : null}
            {result.state === "own_ico_ambiguous" ? <p className="network-muted">IČO vaší firmy je ve Splatnu u více firem. Kontaktujte prosím podporu.</p> : null}
            {result.state === "ambiguous" ? <p className="network-muted">IČO {result.ico} je ve Splatnu evidované u více firem, proto ho nelze jednoznačně propojit. Kontaktujte prosím podporu.</p> : null}
            {result.state === "connected" ? (
              <>
                <PartnerIdentity name={result.partner.name} ico={result.partner.ico} logo={result.partner.logo_path} />
                <p className="network-muted">S touto firmou už jste propojení.</p>
                {result.connection_id ? <div className="network-card-actions"><Link className="btn secondary" href={`/partneri/${result.connection_id}`}>Otevřít detail</Link></div> : null}
              </>
            ) : null}
            {result.state === "pending_outgoing" || result.state === "pending_incoming" ? (
              <>
                <PartnerIdentity name={result.partner.name} ico={result.partner.ico} logo={result.partner.logo_path} />
                <p className="network-muted">{result.state === "pending_outgoing" ? "Žádost už jste odeslali, čeká na přijetí." : "Tato firma vás už žádá o propojení."}</p>
                <div className="network-card-actions"><button type="button" className="btn secondary" onClick={onShowRequests}>Zobrazit žádosti</button></div>
              </>
            ) : null}
            {result.state === "available" ? (
              <form onSubmit={(event) => { event.preventDefault(); void sendRequest(result.partner.name, result.partner.ico); }}>
                <PartnerIdentity name={result.partner.name} ico={result.partner.ico} logo={result.partner.logo_path} detail="používá Splatno" />
                <label className="network-field">
                  <span>Zpráva pro firmu (nepovinné)</span>
                  <textarea maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Dobrý den, propojme se ve Splatnu, ať máme faktury přehledně na jednom místě." />
                </label>
                <div className="network-card-actions">
                  <button type="submit" className="btn primary" disabled={sending}>{sending ? "Odesílám…" : "Poslat žádost o propojení"}</button>
                </div>
              </form>
            ) : null}
            {result.state === "not_on_network" ? (
              <form onSubmit={async (event) => {
                event.preventDefault();
                setSending(true);
                const sent = await onInvite({ ico: result.ico, name: `s IČO ${result.ico}` }, email);
                setSending(false);
                if (sent) { setResult(null); setIco(""); setEmail(""); }
              }}>
                <p className="network-muted">Firma s IČO {result.ico} Splatno zatím nepoužívá. Pošlete jí pozvánku – po registraci se s vámi propojí jedním kliknutím.</p>
                <label className="network-field">
                  <span>E-mail firmy</span>
                  <input type="email" inputMode="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="fakturace@firma.cz" />
                  <small>Pozvánka odejde jednou, jménem vaší firmy, s odkazem na odhlášení.</small>
                </label>
                <div className="network-card-actions">
                  <button type="submit" className="btn primary" disabled={sending || !email.trim()}>{sending ? "Odesílám…" : "Poslat pozvánku"}</button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function InviteCandidates({ candidates, invitations, canManage, busy, onInvite }: {
  candidates: InviteCandidate[];
  invitations: PartnersPageData["invitations"];
  canManage: boolean;
  busy: string | null;
  onInvite: (candidate: { ico: string; name: string }, email: string) => Promise<boolean>;
}) {
  const [emails, setEmails] = useState<Record<string, string>>({});
  return (
    <section className="page-panel network-panel">
      <header>
        <div>
          <small>RŮST SÍTĚ</small>
          <h2>Odběratelé, kteří Splatno nepoužívají</h2>
          <p>Pozvěte je a uvidíte spolu faktury i platby na jednom místě. Každá firma dostane nejvýš jednu pozvánku a jednu připomínku.</p>
        </div>
      </header>
      {candidates.length ? (
        <div className="network-table">
          <table>
            <thead>
              <tr>
                <th>Odběratel</th>
                <th>Faktury</th>
                <th>Neuhrazeno (Kč)</th>
                <th>E-mail</th>
                <th><span className="sr-only">Akce</span></th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => {
                const email = emails[candidate.ico] ?? candidate.email ?? "";
                return (
                  <tr key={candidate.ico}>
                    <td data-label="Odběratel" className="network-cell-primary">
                      <PartnerIdentity name={candidate.name} ico={candidate.ico} logo={null} detail={candidate.invited_at ? `pozváno ${formatDate(candidate.invited_at)}` : null} />
                    </td>
                    <td data-label="Faktury">{plural(Number(candidate.invoice_count), "faktura", "faktury", "faktur")}</td>
                    <td data-label="Neuhrazeno (Kč)" className="money">{formatMoney(Number(candidate.open_amount_czk), "CZK")}</td>
                    <td data-label="E-mail" className="network-cell-wide">
                      {canManage ? (
                        <input
                          type="email"
                          inputMode="email"
                          aria-label={`E-mail pro pozvánku firmy ${candidate.name}`}
                          value={email}
                          maxLength={254}
                          onChange={(event) => setEmails((current) => ({ ...current, [candidate.ico]: event.target.value }))}
                        />
                      ) : (candidate.email ?? "—")}
                    </td>
                    <td data-label="Akce" className="network-cell-actions">
                      {canManage ? (
                        <div className="network-row-actions">
                          <button
                            type="button"
                            className="btn secondary network-invite-button"
                            disabled={busy === `invite:${candidate.ico}` || !email.trim()}
                            onClick={() => void onInvite(candidate, email)}
                          >
                            <Icon name="mail" />{candidate.invited_at ? "Připomenout" : "Pozvat"}
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="payments-empty-state">
          <span><Icon name="users" /></span>
          <strong>Všichni vaši odběratelé s IČO už Splatno používají</strong>
          <p>Nebo zatím nemáte faktury s platným IČO odběratele. Odběratelé se tu objeví automaticky.</p>
        </div>
      )}
      {invitations.length ? (
        <div className="network-panel-body">
          <p className="network-muted">
            Odeslané pozvánky: {invitations.map((invitation) => invitation.accepted_partner
              ? `${invitation.accepted_partner.name} (přijato)`
              : `IČO ${invitation.ico} (${invitation.sent_at ? `odesláno ${formatDate(invitation.sent_at)}` : "neodesláno"}${invitation.expired ? ", vypršelo" : ""})`).join(" · ")}
          </p>
        </div>
      ) : null}
    </section>
  );
}
