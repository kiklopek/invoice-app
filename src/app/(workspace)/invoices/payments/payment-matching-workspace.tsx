"use client";

import { ExactMoney } from "@/components/money-amount";

import { CloseIcon } from "@/components/close-icon";
import { ChevronDown } from "@/components/chevron-down";
import { useId, useRef, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { OWN_TRANSFER_LABEL, UNRELATED_LABEL } from "@/lib/payment-unrelated-rows";
import { reconciliationError } from "@/lib/reconciliation-errors";
import { MatchingDropdown, MatchingPopover, MatchingStatus } from "./payment-matching-popover";
import { confirmAction } from "@/lib/confirm-action";
import { minorUnits } from "@/lib/money";
import { MatchingNotice } from "./payment-matching-notice";
import { isOpenPayment, matchingState, NEED_ORDER, needGroup, paymentDate, paymentMatchesQuery, paymentMoney, safeMatchesLabel, shortReason, type NeedGroup } from "./payment-matching-presentation";
import type { Invoice, Preview, PreviewEntry, PersistedPreviewEntry } from "./payment-matching-types";
import styles from "./payment-matching.module.css";

type AllocationInfo = { values: Invoice[]; allocated: number; difference: number };
const MATCH_REASON_LABELS: Record<string, string> = {
  previous: "Dříve přiřazeno",
  vs: "Shoda VS",
  amount: "Stejná částka",
  name: "Stejné jméno",
};

const NEED_LABELS: Record<NeedGroup, string> = { review: "K ověření", unmatched: "Nespárováno", safe: "Vysoká shoda", other: "Ostatní" };

type Props = {
  preview: Preview; filename: string; queueIndex: number; queueTotal: number;
  canManage: boolean; working: boolean; error: string; done: string;
  selected: Record<string, string[]>; partial: Record<string, boolean>; unrelated: Record<string, boolean>;
  allocationAmounts: Record<string, Record<string, number>>;
  invoiceById: Map<string, Invoice>; candidates: Invoice[]; candidateTotal: number;
  releasedInvoices: Record<string, string[]>; onPickerOpen: (entry: PreviewEntry) => void;
  candidateLoading: boolean; candidateError: string; onCandidateRetry: () => void;
  invoiceQuery: string; invoicePage: number; onInvoiceQuery: (value: string) => void; onInvoicePage: (page: number) => void;
  loadedEntries: Record<string, PersistedPreviewEntry>; ownTransfers: Record<string, string>; matchReasons: Record<string, string>;
  confirmedRows: Set<string>; entryFilter: "all" | PreviewEntry["disposition"]; onEntryFilter: (value: Props["entryFilter"]) => void;
  page: number; total: number; onPage: (page: number) => void;
  accountAck: boolean; onAccountAck: (value: boolean) => void; blockedReason: string | null;
  onChangeFile: () => void; onNextFile: () => void; onCommit: () => void; onSaveRows: (keys: string[]) => void;
  onRelease: (entry: PreviewEntry) => void; onAcknowledgeOverlap: (entry: PreviewEntry) => void;
  onClearAssignment: (entry: PreviewEntry) => void;
  allocationInfo: (entry: PreviewEntry) => AllocationInfo; canConfirm: (entry: PreviewEntry) => boolean;
  onSelected: (key: string, ids: string[]) => void; onPartial: (key: string, value: boolean) => void;
  onAllocation: (key: string, invoiceId: string, value: number) => void; onUnrelated: (key: string, value: boolean) => void;
  onDownload: () => void;
};
const dispositionLabels = { all: "Všechny položky", accepted: "Přijaté", ignored: "Ignorované", error: "Chyby", duplicate: "Duplicity" };

function SelectAll({ checked, mixed, disabled, onChange }: { checked: boolean; mixed: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" aria-label="Vybrat vše na aktuální stránce" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/>;
}

function PaymentDetails({ entry, data }: { entry: PreviewEntry; data: Props }) {
  const reason = entry.bank_payment_id ? data.matchReasons[entry.bank_payment_id] : null;
  const persisted = data.loadedEntries[entry.fingerprint];
  const own = persisted ? data.ownTransfers[persisted.id] : null;
  return <div className={styles.paymentDetail}>
    <dl>
      <dt>Datum</dt><dd>{paymentDate(entry.booked_on)}</dd>
      <dt>Částka</dt><dd>{entry.amount == null ? "—" : entry.currency ? <ExactMoney value={Number(entry.amount)} currency={entry.currency} /> : `${Number(entry.amount).toLocaleString("cs-CZ")} · měna neuvedena`}</dd>
      <dt>Protistrana</dt><dd>{entry.counterparty_name || "Neznámý plátce"}</dd>
      <dt>Variabilní symbol</dt><dd>{entry.variable_symbol || "—"}</dd>
      <dt>Účet</dt><dd>{entry.counterparty_account || "—"}{entry.counterparty_account && !entry.counterparty_account_verified && <small>Kontrolní součet nesedí; ověřte účet ručně.</small>}</dd>
      <dt>Stav řádku</dt><dd>{dispositionLabels[entry.disposition]} · řádek {entry.line_number}</dd>
      {entry.reason && <><dt>Důvod</dt><dd>{entry.reason}</dd></>}
      {entry.proposal_reason && <><dt>Důvod návrhu</dt><dd>{entry.proposal_reason}</dd></>}
      {reason && <><dt>Automatické zaúčtování</dt><dd>{reason}</dd></>}
      {own && <><dt>Vlastní převod</dt><dd>{own}</dd></>}
      {entry.processing_error && <><dt>Chyba zpracování</dt><dd>{reconciliationError(entry.processing_error).error}</dd></>}
      {entry.overlap_warning && <><dt>Možná duplicita</dt><dd>{entry.overlap_acknowledged_by ? "Kontrola původní transakce potvrzena." : "Ověřte původní transakci z jiného formátu výpisu."}</dd></>}
    </dl>
    {entry.proposed_invoice_ids.length > 0 && <div className={styles.proposalDetails}><strong>Navržené faktury</strong>{entry.proposed_invoice_ids.map(id => {
      const invoice = data.invoiceById.get(id);
      return <p key={id}>{invoice ? <>{invoice.invoice_number} · {invoice.counterparty_name} · <ExactMoney value={Number(invoice.amount) - Number(invoice.paid_amount)} currency={invoice.currency} /></> : id}</p>;
    })}</div>}
    <details className={styles.technical}><summary>Technické údaje a diagnostika<ChevronDown /></summary><pre>{JSON.stringify(persisted ?? entry, null, 2)}</pre></details>
  </div>;
}

function PaymentRow({ entry, data, checked, onToggle }: { entry: PreviewEntry; data: Props; checked: boolean; onToggle: () => void }) {
  const key = entry.fingerprint;
  const ids = data.selected[key] ?? [];
  const info = data.allocationInfo(entry);
  const open = isOpenPayment(entry);
  const unrelated = Boolean(data.unrelated[key]);
  const persisted = data.loadedEntries[key];
  const own = persisted ? data.ownTransfers[persisted.id] : null;
  const state = matchingState(entry, ids, unrelated, Boolean(data.partial[key]) || info.difference !== 0);
  // Krátký důvod patří jen k návrhu automatiky, ne k vlastnímu výběru člověka.
  const sameAsProposal = ids.length > 0 && ids.length === entry.proposed_invoice_ids.length && ids.every(id => entry.proposed_invoice_ids.includes(id));
  const saved = data.confirmedRows.has(key);
  const eligible = Boolean(data.canManage && persisted && !data.working && !data.blockedReason && !saved && data.canConfirm(entry));
  const [pickerOpen, setPickerOpen] = useState(false);
  // Rozdělení platby na víc faktur je samostatný, viditelný režim výběru.
  const [splitMode, setSplitMode] = useState(false);
  const hoverId = useId();
  const editable = Boolean(open && !unrelated && data.canManage && persisted && !data.working && data.preview.import.status !== "committed");
  // Server řadí faktury podle této platby (dříve přiřazená, VS, částka, jméno);
  // uvolněné a navržené faktury jsou nahoře i dřív, než seřazený seznam dorazí.
  const preferred = [...(data.releasedInvoices[key] ?? []), ...entry.proposed_invoice_ids];
  const candidates = [...new Map([
    ...data.candidates.filter(invoice => preferred.includes(invoice.id)),
    ...preferred.map(id => data.invoiceById.get(id)).filter((value): value is Invoice => Boolean(value)),
    ...data.candidates,
  ].map(invoice => [invoice.id, invoice])).values()]
    .filter(invoice => !entry.currency || invoice.currency === entry.currency)
    .filter(invoice => !data.invoiceQuery.trim() || data.candidates.some(candidate => candidate.id === invoice.id));
  const openPicker = (value: boolean, split?: boolean) => {
    setPickerOpen(value);
    if (value) { setSplitMode(split ?? ids.length > 1); data.onPickerOpen(entry); }
  };
  const edit = (split?: boolean) => openPicker(true, split);
  const currency = entry.currency || "CZK";
  return <article className={`${styles.row} ${styles[state.tone]} ${unrelated ? styles.unrelated : ""}`} data-payment-row={key}>
    <input type="checkbox" aria-label={`Vybrat platbu, řádek ${entry.line_number}`} checked={checked} disabled={!eligible} onChange={onToggle}/>
    <MatchingStatus {...state}/>
    <div className={styles.payment}>
      <time dateTime={entry.booked_on || undefined}>{paymentDate(entry.booked_on)}</time>
      <strong data-empty={entry.amount == null || undefined}>{entry.amount == null ? "Bez částky" : entry.currency ? <ExactMoney value={Number(entry.amount)} currency={entry.currency} /> : `${Number(entry.amount).toLocaleString("cs-CZ")} · měna neuvedena`}</strong>
      <span>{entry.counterparty_name || "Neznámý plátce"}</span>
    </div>
    <span className={styles.infoWrap}>
      <MatchingPopover label={`Detail platby · řádek ${entry.line_number}`} className={styles.infoButton} trigger={<span aria-hidden="true">i</span>}>
        {() => <PaymentDetails entry={entry} data={data}/>}
      </MatchingPopover>
      <span id={hoverId} role="tooltip" className={styles.hoverInfo}><PaymentDetails entry={entry} data={data}/></span>
    </span>
    <div className={styles.invoiceBlock}>
      {unrelated ? <><strong>{own ? "Vlastní převod" : "Nesouvisí s fakturami"}</strong><small>Nezapíše se jako platba k fakturám</small></> : info.values.length ? <>
        {info.values.map(invoice => <div key={invoice.id} className={styles.invoiceCopy}>
          <span>Faktura {invoice.variable_symbol ? `VS ${invoice.variable_symbol}` : invoice.invoice_number}</span>
          <strong>{invoice.counterparty_name}</strong>
          <small>{invoice.due_date ? `Splatnost ${paymentDate(invoice.due_date)}` : `Číslo ${invoice.invoice_number}`}</small>
        </div>)}
        {info.values.length > 1 && <small className={styles.splitLabel}>Rozděleno na {info.values.length} {info.values.length < 5 ? "faktury" : "faktur"}</small>}
        <span className={styles.labelLine}>
          <small className={styles.matchLabel}>{entry.bank_payment_id ? "Zaúčtováno" : saved ? "Přiřazení uloženo · čeká na zaúčtování" : [state.label, sameAsProposal ? shortReason(entry.proposal_reason) : null].filter(Boolean).join(" · ")}</small>
          {editable && <button type="button" className={styles.splitButton} onClick={() => edit(true)}>Rozdělit platbu</button>}
        </span>
      </> : !open ? <><strong>{entry.bank_payment_id ? "Zaúčtováno" : dispositionLabels[entry.disposition]}</strong><small>Podrobnosti jsou v detailu platby</small></> : null}
      {open && !unrelated && <MatchingDropdown label={`Vybrat fakturu · řádek ${entry.line_number}`} open={pickerOpen} onOpenChange={value => openPicker(value)}
        className={`${styles.invoicePicker} ${info.values.length ? styles.changeInvoice : ""}`}
        trigger={<>{info.values.length ? null : "Vyberte fakturu…"}<ChevronDown /></>}>
        {close => <>
          <label className={styles.pickerSearch}><Icon name="search"/><input aria-label="Hledat fakturu" maxLength={100} value={data.invoiceQuery} onChange={event => data.onInvoiceQuery(event.target.value)} placeholder="Číslo, VS, odběratel nebo IČO"/></label>
          {data.candidateLoading && <p className={styles.hint} role="status">Načítáme faktury…</p>}
          {data.candidateError && <p className={styles.error} role="alert">{data.candidateError} <button type="button" onClick={data.onCandidateRetry}>Zkusit znovu</button></p>}
          {!editable && <p className={styles.hint}>Přiřazení nyní nelze upravovat.</p>}
          {ids.length > 0 && <button type="button" className={styles.clearAssignment} disabled={!editable || Boolean(data.blockedReason)} onClick={() => { close(); data.onClearAssignment(entry); }}>Odstranit přiřazení</button>}
          <label className={styles.splitToggle}>
            <input type="checkbox" aria-label="Platba hradí víc faktur" checked={splitMode} disabled={!editable} onChange={event => setSplitMode(event.target.checked)}/>
            <span><strong>Platba hradí víc faktur</strong><small>Rozdělit platbu a vybrat všechny faktury, které platí</small></span>
          </label>
          {splitMode && <p className={`${styles.splitStatus} ${info.difference === 0 && info.values.length ? styles.splitDone : info.difference < 0 ? styles.splitOver : ""}`} role="status">
            {info.difference > 0 ? `Zbývá rozdělit ${paymentMoney(info.difference, currency)}`
              : info.difference < 0 ? `Přes platbu o ${paymentMoney(-info.difference, currency)}`
              : `Rozděleno celé · ${paymentMoney(Number(entry.amount), currency)}`}
            {info.values.length > 0 && ` · ${info.values.length} ${info.values.length === 1 ? "faktura" : info.values.length < 5 ? "faktury" : "faktur"}`}
          </p>}
          <div className={styles.invoiceOptions} role="group" aria-label="Dostupné faktury">
            {candidates.map(invoice => {
              const chosen = ids.includes(invoice.id);
              const label = invoice.variable_symbol ? `VS ${invoice.variable_symbol}` : invoice.invoice_number;
              const toggle = () => data.onSelected(key, chosen ? ids.filter(id => id !== invoice.id) : [...ids, invoice.id]);
              const reasons = (invoice.match_reasons ?? []).filter(reason => reason in MATCH_REASON_LABELS);
              return <div key={invoice.id} className={styles.invoiceOption} data-invoice-option>
                <label className={styles.optionCheck}><input type="checkbox" aria-label={`Přidat fakturu ${label} k platbě`} checked={chosen} disabled={!editable || data.candidateLoading} onChange={toggle}/></label>
                <button type="button" disabled={!editable || data.candidateLoading} aria-pressed={chosen} onClick={() => {
                  // Jedna faktura: vybrat a zavřít. Při rozdělení (nebo když je
                  // zaškrtnutých víc) klik jen přidá/odebere a výběr zůstane otevřený.
                  if (splitMode || ids.length > 1) { toggle(); return; }
                  data.onSelected(key, [invoice.id]);
                  close();
                }}>
                  <span><strong>{label}</strong><small>{invoice.counterparty_name}</small>
                    {reasons.length > 0 && <span className={styles.matchReasons}>{reasons.map(reason => <em key={reason}>{MATCH_REASON_LABELS[reason]}</em>)}</span>}
                  </span>
                  <time>{paymentDate(invoice.due_date)}</time><b><ExactMoney value={Number(invoice.amount) - Number(invoice.paid_amount)} currency={invoice.currency} /></b>
                </button>
              </div>;
            })}
            {!candidates.length && !data.candidateLoading && !data.candidateError && <p className={styles.hint}>Pro toto hledání a měnu nejsou dostupné faktury.</p>}
          </div>
          <nav className={styles.pagination} aria-label="Stránky kandidátních faktur"><button type="button" disabled={data.invoicePage <= 1} onClick={() => data.onInvoicePage(data.invoicePage - 1)}>Předchozí</button><span>{data.invoicePage} / {Math.max(1, Math.ceil(data.candidateTotal / 25))}</span><button type="button" disabled={data.invoicePage * 25 >= data.candidateTotal} onClick={() => data.onInvoicePage(data.invoicePage + 1)}>Další</button></nav>
          {(splitMode || info.values.length > 1) && <fieldset className={styles.advanced}><legend>Částky k fakturám</legend>

            {info.values.map(invoice => <label key={invoice.id}><span>Faktura {invoice.invoice_number}</span><input aria-label={`Částka k faktuře ${invoice.invoice_number}`} type="number" min="0.01" step="0.01" max={Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount))} value={data.allocationAmounts[key]?.[invoice.id] ?? Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount))} disabled={!editable} onChange={event => data.onAllocation(key, invoice.id, Number(event.target.value))}/></label>)}
          </fieldset>}
          {info.values.length === 1 && (info.difference !== 0 || data.partial[key]) && <label className={styles.partial}><input type="checkbox" checked={Boolean(data.partial[key])} disabled={!editable} onChange={event => data.onPartial(key, event.target.checked)}/>Povolit výslovnou částečnou úhradu této faktury</label>}
          <p className={`${styles.balance} ${info.difference !== 0 ? styles.unbalanced : ""}`}>{info.values.length ? `Platba ${paymentMoney(Number(entry.amount), entry.currency || "CZK")} · vybráno ${paymentMoney(info.allocated, entry.currency || "CZK")} · rozdíl ${paymentMoney(info.difference, entry.currency || "CZK")}` : "Vyberte fakturu, nebo při konečném zaúčtování ponechte platbu nespárovanou."}</p>
          <button type="button" className={styles.primary} onClick={close}>Hotovo</button>
        </>}
      </MatchingDropdown>}
      {editable && !unrelated && !info.values.length && <button type="button" className={styles.splitButton} onClick={() => edit(true)}>Rozdělit platbu</button>}
      {open && info.values.length > 0 && !data.canConfirm(entry) && <small className={styles.inlineWarning}>Ověřte částky{entry.overlap_warning && !entry.overlap_acknowledged_by ? " a možnou duplicitu" : " nebo částečnou úhradu"}.</small>}
    </div>
    <div className={styles.rowActions}>
      {open ? <button type="button" className={styles.primary} disabled={!eligible} title="Uložit kontrolu přiřazení. Samotné zaúčtování provedete akcí Zaúčtovat výpis." onClick={() => data.onSaveRows([key])}>{saved ? "Potvrzeno" : data.working ? "Čekejte…" : "Potvrdit"}</button> : <span className={styles.finished}>{entry.bank_payment_id ? "Zaúčtováno" : dispositionLabels[entry.disposition]}</span>}
      <MatchingPopover label={`Akce platby · řádek ${entry.line_number}`} trigger={<Icon name="more"/>} className={styles.rowMenu}>
        {close => <div className={styles.menu}>
          <MatchingPopover label={`Detail platby · řádek ${entry.line_number}`} trigger="Zobrazit detail platby">{() => <PaymentDetails entry={entry} data={data}/>}</MatchingPopover>
          {editable && <>
            {/* Výběr se otevře až po zavření nabídky: dialog nabídky vrací fokus
                na své tlačítko a výběr by to jinak vzal jako klik mimo a hned se zavřel. */}
            <button type="button" onClick={() => { close(); window.setTimeout(() => edit(false), 0); }}>Změnit přiřazení</button>
            {ids.length > 0 && <button type="button" disabled={Boolean(data.blockedReason)} onClick={() => { close(); data.onClearAssignment(entry); }}>Odstranit přiřazení</button>}
            {entry.proposal_confidence !== "safe" && entry.proposed_invoice_ids.length > 0 && <button type="button" onClick={() => { data.onSelected(key, entry.proposed_invoice_ids); close(); }}>Použít navrženou kombinaci</button>}
          </>}
          {info.values.map(invoice => <Link key={invoice.id} href={`/invoices/${invoice.id}`}>Zobrazit fakturu {invoice.invoice_number}</Link>)}
          {open && data.canManage && data.preview.import.status !== "committed" && <button type="button" disabled={data.working || !persisted} onClick={() => { data.onUnrelated(key, !unrelated); close(); }}>{unrelated ? "Vrátit mezi platby" : "Nesouvisí s fakturami"}</button>}
          {entry.overlap_warning && !entry.overlap_acknowledged_by && open && data.canManage && <button type="button" disabled={data.working || !persisted} onClick={() => { close(); data.onAcknowledgeOverlap(entry); }}>Ověřeno: jde o další platbu</button>}
          {entry.bank_payment_id && data.canManage && <button type="button" disabled={data.working || !persisted} onClick={() => { close(); data.onRelease(entry); }}>Uvolnit platbu a změnit přiřazení</button>}
          {unrelated && <p className={styles.hint}>{own ? OWN_TRANSFER_LABEL : UNRELATED_LABEL}</p>}
        </div>}
      </MatchingPopover>
    </div>
  </article>;
}

export function PaymentMatchingWorkspace(data: Props) {
  const [query, setQuery] = useState("");
  const [needFilter, setNeedFilter] = useState<NeedGroup | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(() => new Set());
  const groupOf = (entry: PreviewEntry) => {
    const key = entry.fingerprint;
    const ids = data.selected[key] ?? [];
    const adjusted = Boolean(data.partial[key]) || data.allocationInfo(entry).difference !== 0;
    return needGroup(entry, matchingState(entry, ids, Boolean(data.unrelated[key]), adjusted));
  };
  const groups = new Map(data.preview.entries.map(entry => [entry.fingerprint, groupOf(entry)]));
  const count = (group: NeedGroup) => data.preview.entries.filter(entry => groups.get(entry.fingerprint) === group).length;
  // Nejdřív to, co potřebuje člověka; v rámci skupiny pořadí výpisu.
  const visible = data.preview.entries
    .filter(entry => paymentMatchesQuery(entry, query) && (!needFilter || groups.get(entry.fingerprint) === needFilter))
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => NEED_ORDER[groups.get(a.entry.fingerprint) ?? "other"] - NEED_ORDER[groups.get(b.entry.fingerprint) ?? "other"] || a.index - b.index)
    .map(({ entry }) => entry);
  const eligible = visible.filter(entry => data.canManage && !data.working && !data.blockedReason && data.loadedEntries[entry.fingerprint] && !data.confirmedRows.has(entry.fingerprint) && data.canConfirm(entry)).map(entry => entry.fingerprint);
  const selected = eligible.filter(key => selectedRows.has(key));
  const selectAll = (value: boolean) => setSelectedRows(new Set(value ? eligible : []));
  // Jisté shody na celém načteném výpisu, které jdou potvrdit (stejná pravidla
  // jako „Potvrdit vybrané“; jen uloží kontrolu, nic nezaúčtuje).
  const safeReady = data.preview.entries.filter(entry => groups.get(entry.fingerprint) === "safe" && data.canManage && !data.working && !data.blockedReason
    && data.loadedEntries[entry.fingerprint] && !data.confirmedRows.has(entry.fingerprint) && data.canConfirm(entry));
  const safeTotal = safeReady.reduce((sum, entry) => sum + minorUnits(Number(entry.amount ?? 0)), 0) / 100;
  const safeCurrency = safeReady.every(entry => entry.currency === safeReady[0]?.currency) ? safeReady[0]?.currency ?? "CZK" : null;
  const confirmSafe = async () => {
    const keys = safeReady.map(entry => entry.fingerprint);
    if (!keys.length) return;
    const ok = await confirmAction({
      title: `Potvrdit ${safeMatchesLabel(keys.length)}?`,
      description: `Uloží se kontrola ${keys.length} ${keys.length === 1 ? "platby" : "plateb"}${safeCurrency ? ` v celkové výši ${paymentMoney(safeTotal, safeCurrency)}` : ""}. Peníze se zapíšou až tlačítkem Zaúčtovat výpis.`,
      confirmLabel: "Potvrdit",
      confirmVariant: "primary",
    });
    if (ok) data.onSaveRows(keys);
  };
  const pageScoped = data.total > data.preview.entries.length;
  const activeFilterCount = Number(needFilter !== null) + Number(data.entryFilter !== "all");
  const resetFilters = () => { setNeedFilter(null); data.onEntryFilter("all"); setQuery(""); selectAll(false); };
  return <section className={styles.workspace} data-payment-matching>
    <header className={styles.heading}>
      <div><h1>Párování plateb</h1><p>Zkontrolujte a potvrďte přiřazení plateb k fakturám.</p></div>
      <div className={styles.fileSummary}><span className={styles.fileIcon}><Icon name="document"/></span><div className="gpc-file-summary-copy"><strong id="gpc-statement-title" title={data.filename}>{data.filename}</strong><small>Načteno {data.preview.total_entries} položek{data.queueTotal > 1 ? ` · Výpis ${data.queueIndex + 1} z ${data.queueTotal}` : ""}</small></div>
        <MatchingPopover label="Možnosti výpisu" trigger={<Icon name="more"/>} className={styles.fileMenu}>{close => <div className={styles.menu}><button type="button" disabled={data.working} onClick={() => { close(); data.onChangeFile(); }}>Nahrát jiný soubor</button><button type="button" onClick={data.onDownload}>Stáhnout originál výpisu</button><Link href="/invoices/payments/archive">Platby a archiv</Link></div>}</MatchingPopover>
      </div>
    </header>
    {data.error && <p className={styles.error} role="alert">{data.error}</p>}
    {data.done && <MatchingNotice message={data.done} className={styles.success} />}
    {data.preview.import.duplicate && <MatchingNotice key={data.preview.import.id} className={styles.duplicate} message="Tento výpis už byl dříve nahraný. Zobrazujeme jeho existující výsledky." />}
    {data.preview.account_mismatch && <details className={styles.accountWarning}><summary><Icon name="alert"/>{data.accountAck ? "Kontrola bankovního účtu potvrzena" : "Bankovní účet vyžaduje kontrolu"}<span>Podrobnosti <ChevronDown /></span></summary><div><p>Účet ve výpisu není mezi účty firmy (Nastavení → Firma).</p><p>Ve výpisu: <strong>{data.preview.statement_account || "neznámý"}</strong> · Nastaveno: <strong>{data.preview.expected_account || "neznámý"}</strong></p><label><input type="checkbox" checked={data.accountAck} disabled={!data.canManage || data.working} onChange={event => data.onAccountAck(event.target.checked)}/>Potvrdit kontrolu bankovního účtu</label></div></details>}
    <section className={styles.summary} aria-label="Souhrn výpisu">
      {pageScoped && <span className={styles.summaryScope}>Tato stránka:</span>}
      {(["review", "unmatched", "safe"] as const).map(group =>
        <button type="button" key={group} className={styles[`need_${group}`]} aria-pressed={needFilter === group} disabled={!count(group) && needFilter !== group}
          onClick={() => { setNeedFilter(current => current === group ? null : group); selectAll(false); }}>
          <i aria-hidden="true"/>{count(group)} {NEED_LABELS[group].toLowerCase()}
        </button>)}
      {safeReady.length > 0 && <button type="button" className={styles.confirmSafe} onClick={() => void confirmSafe()}>
        Potvrdit {safeMatchesLabel(safeReady.length)}{safeCurrency ? <small> · {paymentMoney(safeTotal, safeCurrency)}</small> : null}
      </button>}
    </section>
    <div className={styles.toolbar}>

      <label className={styles.search}><Icon name="search"/><input aria-label="Hledat platby na aktuální stránce" placeholder="Hledat částku, VS nebo název…" value={query} onChange={event => { setQuery(event.target.value); selectAll(false); }}/></label>
      <MatchingPopover label="Filtry plateb" trigger={<><Icon name="filter"/>{activeFilterCount > 0 && <span className={styles.filterCount} aria-hidden="true">{activeFilterCount}</span>}</>} className={`${styles.filterButton} ${activeFilterCount ? styles.filterActive : ""}`}>{close => <div className={styles.filters}><label>Typ položek<select aria-label="Typ položek" value={data.entryFilter} onChange={event => { data.onEntryFilter(event.target.value as Props["entryFilter"]); selectAll(false); }}>{Object.entries(dispositionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><dl><dt>Přijaté</dt><dd>{data.preview.totals.accepted}</dd><dt>Ignorované</dt><dd>{data.preview.totals.ignored}</dd><dt>Chyby</dt><dd>{data.preview.totals.errors}</dd><dt>Celkem</dt><dd>{data.preview.total_entries}</dd></dl>
        {data.preview.statement_bank && <p>{data.preview.statement_bank.name || "Banka neurčena"}{!data.preview.statement_bank.verified && " · Banka zatím není ověřená na vzorku. Párování používá VS a částku, nikoli číslo účtu plátce."}</p>}
        <details className={styles.technical}><summary>Údaje importu<ChevronDown /></summary><pre>{JSON.stringify(data.preview.import, null, 2)}</pre></details>
        <div className={styles.filterActions}><button type="button" onClick={resetFilters}>Resetovat</button><button type="button" onClick={close}>Zobrazit výsledky</button></div>
      </div>}</MatchingPopover>
    </div>
    {activeFilterCount > 0 && <div className={styles.activeFilters} aria-label="Aktivní filtry plateb">
      {needFilter && <button type="button" aria-label="Zrušit filtr stavu párování" onClick={() => { setNeedFilter(null); selectAll(false); }}>{NEED_LABELS[needFilter]}<CloseIcon/></button>}
      {data.entryFilter !== "all" && <button type="button" aria-label="Zrušit filtr typu položek" onClick={() => { data.onEntryFilter("all"); selectAll(false); }}>{dispositionLabels[data.entryFilter]}<CloseIcon/></button>}
    </div>}
    {pageScoped && <p className={styles.scope}>Aktuální stránka: {data.preview.entries.length} z {data.total} položek. Souhrn, filtry a hledání pracují s touto stránkou.</p>}
    <div className="gpc-preview"><div className={styles.rows}>
      {visible.map(entry => <PaymentRow key={entry.fingerprint} entry={entry} data={data} checked={selected.includes(entry.fingerprint)} onToggle={() => setSelectedRows(current => { const next = new Set(current); if (next.has(entry.fingerprint)) next.delete(entry.fingerprint); else next.add(entry.fingerprint); return next; })}/>)}
      {!visible.length && <div className={styles.empty}><strong>Žádné položky v tomto zobrazení</strong><p>Změňte stavový filtr, hledání nebo stránku výpisu.</p><button type="button" onClick={() => { setNeedFilter(null); setQuery(""); }}>Zrušit hledání a stavový filtr</button></div>}
    </div></div>
    {data.total > 50 && <nav className={styles.pagination} aria-label="Stránky náhledu výpisu"><button type="button" disabled={data.page <= 1 || data.working} onClick={() => { selectAll(false); data.onPage(data.page - 1); }}>Předchozí položky</button><span>Stránka {data.page} / {Math.ceil(data.total / 50)}</span><button type="button" disabled={data.page * 50 >= data.total || data.working} onClick={() => { selectAll(false); data.onPage(data.page + 1); }}>Další položky</button></nav>}
    {data.preview.import.status !== "committed" && <footer className={styles.footer}>
      <label><SelectAll checked={eligible.length > 0 && selected.length === eligible.length} mixed={selected.length > 0 && selected.length < eligible.length} disabled={!eligible.length} onChange={selectAll}/>Vybrat vše ({eligible.length})</label>
      <span>Vybráno {selected.length} z {eligible.length}</span>
      <div className={styles.footerActions}><button type="button" disabled={data.working} onClick={data.onChangeFile}>Zpět</button><button type="button" className={styles.primary} disabled={!selected.length || data.working} onClick={() => data.onSaveRows(selected)}>Potvrdit vybrané</button><button type="button" className={styles.bookButton} disabled={!data.canManage || data.working || Boolean(data.blockedReason) || data.preview.entries.some(entry => !data.loadedEntries[entry.fingerprint])} onClick={data.onCommit}>{data.working ? "Čekejte…" : "Zaúčtovat výpis"}</button></div>
      <p>Potvrzení uloží přiřazení. Zaúčtování se týká celého výpisu, včetně plateb bez faktury; ty se uloží jako nespárované.</p>
      {data.blockedReason && <small className={styles.inlineWarning} role="status">{data.blockedReason}</small>}
    </footer>}
    {data.preview.import.status === "committed" && <div className={styles.completed}><p>Výpis je zaúčtovaný.</p><button type="button" className={styles.primary} disabled={data.working} onClick={data.queueIndex + 1 < data.queueTotal ? data.onNextFile : data.onChangeFile}>{data.queueIndex + 1 < data.queueTotal ? `Pokračovat dalším výpisem (${data.queueIndex + 2} z ${data.queueTotal})` : "Nahrát další výpis"}</button></div>}
  </section>;
}
