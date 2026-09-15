"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Icon } from "@/components/icons";

type Invoice = {
  id: string;
  invoice_number: string;
  counterparty_name: string;
  amount: number;
  paid_amount: number;
  currency: string;
  variable_symbol: string | null;
};
type PreviewEntry = {
  line_number: number;
  fingerprint: string;
  disposition: "accepted" | "ignored" | "error" | "duplicate";
  reason: string | null;
  amount: number | null;
  currency: string | null;
  booked_on: string | null;
  variable_symbol: string | null;
  counterparty_name: string | null;
  proposal_kind:
    | "exact"
    | "combination"
    | "account_suggestion"
    | "ambiguous"
    | "manual"
    | null;
  proposal_confidence: "safe" | "review" | null;
  proposal_reason: string | null;
  proposed_invoice_ids: string[];
};
type PersistedPreviewEntry = PreviewEntry & { id: string };
type PreviewDetail = {
  entries: PersistedPreviewEntry[];
  allocations: Array<{
    statement_entry_id: string | null;
    invoice_id: string;
    is_manual_partial: boolean;
  }>;
  proposal_invoices: Invoice[];
  total: number;
};
type Preview = {
  import: { id: string; revision: number; duplicate: boolean; status: string };
  account_mismatch: boolean;
  totals: { accepted: number; ignored: number; errors: number };
  entries: PreviewEntry[];
  proposal_invoices: Invoice[];
  total_entries: number;
  request_id: string;
};
type ArchiveItem = {
  id: string;
  original_filename: string;
  status: string;
  entry_count: number;
  accepted_count: number;
  ignored_count: number;
  error_count: number;
  created_at: string;
  committed_at: string | null;
};

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("cs-CZ", { style: "currency", currency }).format(value);
const labels = {
  exact: "Přesná shoda",
  combination: "Kombinovaná platba",
  account_suggestion: "Návrh podle účtu",
  ambiguous: "Nejednoznačné",
  manual: "Ruční kontrola",
};

export function GpcImportPanel({
  invoices,
  canManage,
  onCommitted,
}: {
  invoices: Invoice[];
  canManage: boolean;
  onCommitted: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [partial, setPartial] = useState<Record<string, boolean>>({});
  const [previewPage, setPreviewPage] = useState(1);
  const [entryFilter, setEntryFilter] = useState<"all" | PreviewEntry["disposition"]>("all");
  const [filteredEntriesTotal, setFilteredEntriesTotal] = useState(0);
  const [loadedEntries, setLoadedEntries] = useState<
    Record<string, PersistedPreviewEntry>
  >({});
  const touchedEntries = useRef(new Set<string>());
  const [accountAck, setAccountAck] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [invoicePage, setInvoicePage] = useState(1);
  const [candidateInvoices, setCandidateInvoices] = useState<Invoice[]>(
    invoices.slice(0, 25),
  );
  const [candidateTotal, setCandidateTotal] = useState(invoices.length);
  const [invoiceById, setInvoiceById] = useState<Map<string, Invoice>>(
    () => new Map(invoices.map((invoice) => [invoice.id, invoice])),
  );
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [selectedFilename, setSelectedFilename] = useState("");
  const previewImportId = preview?.import.id;

  useEffect(() => {
    apiFetch<{ imports: ArchiveItem[] }>("/api/payments/imports")
      .then((data) => setArchive(data.imports))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void apiFetch<{ invoices: Invoice[]; total: number }>(
        `/api/payments/invoice-candidates?q=${encodeURIComponent(invoiceQuery.trim())}&page=${invoicePage}`,
      )
        .then((data) => {
          setCandidateInvoices(data.invoices);
          setCandidateTotal(data.total);
          setInvoiceById(
            (current) =>
              new Map([
                ...current,
                ...data.invoices.map(
                  (invoice) => [invoice.id, invoice] as const,
                ),
              ]),
          );
        })
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [invoicePage, invoiceQuery]);

  useEffect(() => {
    if (!previewImportId) return;
    let active = true;
    apiFetch<PreviewDetail>(
      `/api/payments/imports/${previewImportId}?page=${previewPage}${entryFilter === "all" ? "" : `&status=${entryFilter}`}`,
    )
      .then((detail) => {
        if (!active) return;
        setFilteredEntriesTotal(detail.total);
        setPreview((current) =>
          current
            ? {
                ...current,
                entries: detail.entries,
                proposal_invoices: detail.proposal_invoices,
              }
            : current,
        );
        setLoadedEntries((current) => {
          const next = { ...current };
          for (const entry of detail.entries) next[entry.fingerprint] = entry;
          return next;
        });
        setInvoiceById(
          (current) =>
            new Map([
              ...current,
              ...detail.proposal_invoices.map(
                (invoice) => [invoice.id, invoice] as const,
              ),
            ]),
        );
        const allocationsByEntry = new Map<string, string[]>();
        for (const allocation of detail.allocations) {
          if (!allocation.statement_entry_id) continue;
          allocationsByEntry.set(allocation.statement_entry_id, [
            ...(allocationsByEntry.get(allocation.statement_entry_id) ?? []),
            allocation.invoice_id,
          ]);
        }
        setSelected((current) => {
          const next = { ...current };
          for (const entry of detail.entries)
            if (!touchedEntries.current.has(entry.fingerprint))
              next[entry.fingerprint] = allocationsByEntry.get(entry.id) ?? [];
          return next;
        });
        setPartial((current) => {
          const next = { ...current };
          for (const entry of detail.entries)
            if (!touchedEntries.current.has(entry.fingerprint))
              next[entry.fingerprint] = detail.allocations.some(
                (allocation) =>
                  allocation.statement_entry_id === entry.id &&
                  allocation.is_manual_partial,
              );
          return next;
        });
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Stránku náhledu se nepodařilo načíst.",
          );
      });
    return () => {
      active = false;
    };
  }, [entryFilter, previewImportId, previewPage]);

  async function upload(file: File | null) {
    setError("");
    setDone("");
    setPreview(null);
    setSelected({});
    setPartial({});
    setPreviewPage(1);
    setEntryFilter("all");
    setFilteredEntriesTotal(0);
    setLoadedEntries({});
    touchedEntries.current.clear();
    setAccountAck(false);
    setSelectedFilename(file?.name ?? "");
    if (!file) return;
    setWorking(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const data = await apiFetch<Preview>(
        "/api/payments/imports",
        {
          method: "POST",
          body: form,
          headers: {
            "x-idempotency-key": `gpc-${file.name}-${file.size}-${file.lastModified}`,
          },
        },
        45_000,
      );
      setPreview(data);
      setFilteredEntriesTotal(data.total_entries);
      setInvoiceById(
        (current) =>
          new Map([
            ...current,
            ...(data.proposal_invoices ?? []).map(
              (invoice) => [invoice.id, invoice] as const,
            ),
          ]),
      );
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError && cause.requestId
          ? `${cause.message} ID požadavku: ${cause.requestId}`
          : cause instanceof Error
            ? cause.message
            : "Výpis se nepodařilo nahrát.",
      );
    } finally {
      setWorking(false);
    }
  }

  function allocationInfo(entry: PreviewEntry) {
    const ids = selected[entry.fingerprint] ?? [];
    const paymentAmount = Number(entry.amount ?? 0);
    const values = ids
      .map((id) => invoiceById.get(id))
      .filter((invoice): invoice is Invoice => Boolean(invoice));
    let allocated = values.reduce(
      (sum, invoice) =>
        sum + Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount)),
      0,
    );
    if (partial[entry.fingerprint] && values.length === 1)
      allocated = Math.min(allocated, paymentAmount);
    return { values, allocated, difference: paymentAmount - allocated };
  }

  async function commit() {
    if (!preview) return;
    const reviewedEntries = Object.values(loadedEntries).filter(
      (entry) => entry.disposition === "accepted",
    );
    if (reviewedEntries.length < preview.totals.accepted) {
      setError(
        "Než import potvrdíte, projděte všechny stránky přijatých položek.",
      );
      return;
    }
    const invalid = reviewedEntries.find(
      (entry) =>
        (selected[entry.fingerprint]?.length ?? 0) > 0 &&
        Math.abs(allocationInfo(entry).difference) >= 0.005,
    );
    if (invalid) {
      setError(
        `Řádek ${invalid.line_number}: součet vybraných faktur neodpovídá platbě. Upravte výběr nebo výslovně zvolte částečnou úhradu.`,
      );
      return;
    }
    setWorking(true);
    setError("");
    setDone("");
    try {
      const allocations = reviewedEntries.flatMap((entry) => {
        const info = allocationInfo(entry);
        return info.values.map((invoice, index) => ({
          entry_id: entry.id,
          invoice_id: invoice.id,
          amount:
            partial[entry.fingerprint] && info.values.length === 1
              ? info.allocated
              : Math.max(
                  0,
                  Number(invoice.amount) - Number(invoice.paid_amount),
                ),
          is_manual_partial: Boolean(partial[entry.fingerprint]) && index === 0,
        }));
      });
      const saved = await apiFetch<{ revision: number }>(
        `/api/payments/imports/${preview.import.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": `save-${preview.import.id}-${preview.import.revision}`,
          },
          body: JSON.stringify({
            revision: preview.import.revision,
            reviewed_entry_ids: reviewedEntries.map((entry) => entry.id),
            allocations,
          }),
        },
      );
      const result = await apiFetch<{ imported: number; matched: number }>(
        `/api/payments/imports/${preview.import.id}/commit`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": `commit-${preview.import.id}`,
          },
          body: JSON.stringify({
            revision: saved.revision,
            acknowledge_account_mismatch: accountAck,
          }),
        },
        45_000,
      );
      setDone(
        `Import je dokončený: ${result.imported} plateb, ${result.matched} přiřazených položek.`,
      );
      setPreview((current) =>
        current
          ? {
              ...current,
              import: {
                ...current.import,
                status: "committed",
                revision: saved.revision + 1,
              },
            }
          : current,
      );
      onCommitted();
      const refreshed = await apiFetch<{ imports: ArchiveItem[] }>(
        "/api/payments/imports",
      );
      setArchive(refreshed.imports);
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError && cause.requestId
          ? `${cause.message} ID požadavku: ${cause.requestId}`
          : cause instanceof Error
            ? cause.message
            : "Import se nepodařilo potvrdit.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function download(item: ArchiveItem) {
    try {
      const data = await apiFetch<{ url: string }>(
        `/api/payments/imports/${item.id}?download=1`,
      );
      window.location.assign(data.url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Soubor se nepodařilo stáhnout.",
      );
    }
  }

  return (
    <>
      <section className="page-panel import-panel payment-import-panel gpc-panel" aria-labelledby="gpc-import-title">
        <div className="gpc-intro-grid">
          <div className="gpc-upload-column">
            <div className="gpc-title-row">
              <span className="payments-section-number">01</span>
              <div><span className="gpc-eyebrow">AUTOMATICKÉ PÁROVÁNÍ</span><h2 id="gpc-import-title">Nahrát bankovní výpis</h2></div>
            </div>
            <p className="gpc-lead">Bezpečně zpracuje příchozí CZK platby, chybný variabilní symbol i jednu platbu rozdělenou mezi více faktur. Podporovány jsou výpisy GPC i CSV.</p>
            <label className={`gpc-dropzone ${working ? "is-working" : ""}`}>
              <input
                type="file"
                accept=".gpc,.csv,application/octet-stream,text/plain,text/csv"
                disabled={!canManage || working}
                onChange={(event) => upload(event.target.files?.[0] ?? null)}
              />
              <span className="gpc-dropzone-icon"><Icon name="upload" /></span>
              <strong>{working ? "Analyzuji výpis…" : selectedFilename || "Vyberte soubor .gpc nebo .csv"}</strong>
              <small>{canManage ? "Klikněte a vyberte soubor z počítače" : "Import vyžaduje roli účetní nebo administrátor"}</small>
            </label>
          </div>
          <aside className="gpc-safety-card">
            <span className="gpc-safety-icon"><Icon name="check" /></span>
            <h3>Nejdřív kontrola, potom zápis</h3>
            <ol>
              <li><strong>Náhled nic nemění.</strong><span>Výpis se pouze načte a vyhodnotí.</span></li>
              <li><strong>Sporné platby zůstanou ruční.</strong><span>Bezpečná shoda musí sedět VS, měna i částka.</span></li>
              <li><strong>Potvrzení je atomické.</strong><span>Buď se uloží vše, nebo se neuloží nic.</span></li>
            </ol>
          </aside>
        </div>
        <div className="gpc-progress-wrap">
          <span>Průběh zpracování</span>
          <div className="import-steps" aria-label="Průběh importu">
            {["Soubor", "Náhled", "Kontrola", "Potvrzení", "Výsledek"].map(
              (step, index) => (
                <span
                  className={
                    preview
                      ? index <= (done ? 4 : 2)
                        ? "active"
                        : ""
                      : index === 0
                        ? "active"
                        : ""
                  }
                  key={step}
                >
                  {index + 1}. {step}
                </span>
              ),
            )}
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
        {done && <p className="form-success">{done}</p>}
        {preview && (
          <div className="gpc-preview">
            {preview.import.duplicate && (
              <p className="form-success">
                Tento výpis už byl dříve nahraný. Zobrazujeme jeho existující náhled.
              </p>
            )}
            {preview.account_mismatch && (
              <label className="account-warning">
                <input
                  type="checkbox"
                  checked={accountAck}
                  onChange={(event) => setAccountAck(event.target.checked)}
                />{" "}
                <span>
                  <strong>Účet ve výpisu neodpovídá firemnímu CZK účtu.</strong>{" "}
                  Před potvrzením ověřte soubor a výslovně potvrďte pokračování.
                </span>
              </label>
            )}
            <div className="payment-result">
              <div>
                <span>Přijaté</span>
                <strong>{preview.totals.accepted}</strong>
              </div>
              <div>
                <span>Ignorované</span>
                <strong>{preview.totals.ignored}</strong>
              </div>
              <div>
                <span>Chyby</span>
                <strong>{preview.totals.errors}</strong>
              </div>
              <div>
                <span>Celkem</span>
                <strong>{preview.total_entries}</strong>
              </div>
            </div>
            <div className="gpc-review-toolbar" aria-label="Filtr položek výpisu">
              <div>
                <strong>Kontrola položek</strong>
                <span>Zobrazujeme nejvýše 50 řádků na stránku.</span>
              </div>
              <div className="gpc-filter-chips">
                {([
                  ["all", "Vše"],
                  ["accepted", "Přijaté"],
                  ["ignored", "Ignorované"],
                  ["error", "Chyby"],
                  ["duplicate", "Duplicity"],
                ] as const).map(([value, label]) => (
                  <button key={value} type="button" className={entryFilter === value ? "active" : ""} aria-pressed={entryFilter === value} onClick={() => { setEntryFilter(value); setPreviewPage(1); }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="invoice-search">
              Hledat fakturu
              <input
                value={invoiceQuery}
                onChange={(event) => {
                  setInvoicePage(1);
                  setInvoiceQuery(event.target.value);
                }}
                placeholder="Číslo, odběratel, IČO nebo VS"
              />
            </label>
            <div className="gpc-entry-list">
              {preview.entries.map((entry) => {
                const info = allocationInfo(entry);
                return (
                  <article
                    key={`${entry.line_number}-${entry.fingerprint}`}
                    className={`gpc-entry ${entry.disposition}`}
                  >
                    <header>
                      <strong>
                        Řádek {entry.line_number} ·{" "}
                        {entry.counterparty_name || "Bez názvu"}
                      </strong>
                      <span>
                        {entry.amount != null && entry.currency
                          ? money(Number(entry.amount), entry.currency)
                          : entry.disposition}
                      </span>
                    </header>
                    <p>
                      VS {entry.variable_symbol || "—"} ·{" "}
                      {entry.proposal_kind
                        ? labels[entry.proposal_kind]
                        : entry.reason}
                    </p>
                    {entry.proposal_reason && (
                      <small>{entry.proposal_reason}</small>
                    )}
                    {entry.disposition === "accepted" && (
                      <>
                        {entry.proposed_invoice_ids.length > 0 &&
                          entry.proposal_confidence !== "safe" && (
                            <button
                              type="button"
                              className="btn secondary compact"
                              onClick={() => {
                                touchedEntries.current.add(entry.fingerprint);
                                setSelected((current) => ({
                                  ...current,
                                  [entry.fingerprint]:
                                    entry.proposed_invoice_ids,
                                }));
                              }}
                            >
                              Použít navrženou kombinaci
                            </button>
                          )}
                        <details>
                          <summary>Upravit přiřazení faktur</summary>
                          {/* Faktura v jiné měně než platba by se nikdy nedala bezpečně zaúčtovat
                              (commit ji stejně odmítne) — proto se nenabízí k výběru vůbec,
                              místo aby zůstatek dole tiše sečetl nesourodé měny jako "vyrovnáno". */}
                          <div className="invoice-choice-list">
                            {candidateInvoices
                              .filter((invoice) => !entry.currency || invoice.currency === entry.currency)
                              .map((invoice) => (
                              <label key={invoice.id}>
                                <input
                                  type="checkbox"
                                  checked={(
                                    selected[entry.fingerprint] ?? []
                                  ).includes(invoice.id)}
                                  onChange={(event) => {
                                    touchedEntries.current.add(
                                      entry.fingerprint,
                                    );
                                    setSelected((current) => ({
                                      ...current,
                                      [entry.fingerprint]: event.target.checked
                                        ? [
                                            ...(current[entry.fingerprint] ??
                                              []),
                                            invoice.id,
                                          ]
                                        : (
                                            current[entry.fingerprint] ?? []
                                          ).filter((id) => id !== invoice.id),
                                    }));
                                  }}
                                />{" "}
                                <span>
                                  {invoice.invoice_number} ·{" "}
                                  {invoice.counterparty_name} ·{" "}
                                  {money(
                                    Number(invoice.amount) -
                                      Number(invoice.paid_amount),
                                    invoice.currency,
                                  )}
                                </span>
                              </label>
                            ))}
                          </div>
                          <div className="candidate-pagination">
                            <button
                              type="button"
                              disabled={invoicePage <= 1}
                              onClick={() => setInvoicePage((page) => page - 1)}
                            >
                              Předchozí
                            </button>
                            <span>
                              {invoicePage} /{" "}
                              {Math.max(1, Math.ceil(candidateTotal / 25))}
                            </span>
                            <button
                              type="button"
                              disabled={invoicePage * 25 >= candidateTotal}
                              onClick={() => setInvoicePage((page) => page + 1)}
                            >
                              Další
                            </button>
                          </div>
                        </details>
                        {info.values.length === 1 && info.difference > 0 && (
                          <label className="partial-exception">
                            <input
                              type="checkbox"
                              checked={Boolean(partial[entry.fingerprint])}
                              onChange={(event) => {
                                touchedEntries.current.add(entry.fingerprint);
                                setPartial((current) => ({
                                  ...current,
                                  [entry.fingerprint]: event.target.checked,
                                }));
                              }}
                            />{" "}
                            Povolit výslovnou částečnou úhradu této faktury
                          </label>
                        )}
                        <div
                          className={`allocation-balance ${Math.abs(info.difference) < 0.005 ? "balanced" : "unbalanced"}`}
                        >
                          Platba{" "}
                          {money(Number(entry.amount), entry.currency || "CZK")}{" "}
                          · vybráno{" "}
                          {money(info.allocated, entry.currency || "CZK")} ·
                          rozdíl{" "}
                          {money(info.difference, entry.currency || "CZK")}
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
            {filteredEntriesTotal > 50 && (
              <nav
                className="candidate-pagination"
                aria-label="Stránky náhledu výpisu"
              >
                <button
                  type="button"
                  disabled={previewPage <= 1 || working}
                  onClick={() => setPreviewPage((page) => page - 1)}
                >
                  Předchozí položky
                </button>
                <span>
                  Stránka {previewPage} /{" "}
                  {Math.ceil(filteredEntriesTotal / 50)}
                </span>
                <button
                  type="button"
                  disabled={
                    previewPage * 50 >= filteredEntriesTotal || working
                  }
                  onClick={() => setPreviewPage((page) => page + 1)}
                >
                  Další položky
                </button>
              </nav>
            )}
            {preview.import.status !== "committed" && (
              <button
                className="btn primary import-confirm"
                disabled={working || (preview.account_mismatch && !accountAck)}
                onClick={commit}
              >
                {working ? "Potvrzuji…" : "Uložit kontrolu a potvrdit import"}
              </button>
            )}
          </div>
        )}
      </section>
      <section className="page-panel data-panel import-archive" id="archiv-vypisu">
        <header className="panel-head">
          <span className="payments-section-number">02</span>
          <div className="payments-section-heading">
            <small>ULOŽENÉ VÝPISY</small>
            <h2>Archiv bankovních výpisů</h2>
            <p>
              Originály jsou v soukromém úložišti; odkaz platí pouze 60 sekund.
            </p>
          </div>
          <span className="payments-record-count">{archive.length} {archive.length === 1 ? "výpis" : archive.length > 1 && archive.length < 5 ? "výpisy" : "výpisů"}</span>
        </header>
        {archive.length ? (
          <div className="statement-archive-list">
            {archive.map((item) => (
              <article className="statement-archive-item" key={item.id}>
                <span className="statement-file-icon"><Icon name="document" /></span>
                <div className="statement-file-main">
                  <strong title={item.original_filename}>{item.original_filename}</strong>
                  <span>{new Date(item.created_at).toLocaleString("cs-CZ")}</span>
                </div>
                <div className="statement-file-stats">
                  <span><strong>{item.accepted_count}</strong> přijatých</span>
                  <span className={item.error_count ? "has-errors" : ""}><strong>{item.error_count}</strong> chyb</span>
                </div>
                <span className={`statement-status ${item.status === "committed" ? "committed" : "review"}`}>
                  {item.status === "committed" ? "Potvrzeno" : "Ke kontrole"}
                </span>
                <button type="button" className="statement-download" onClick={() => download(item)} aria-label={`Stáhnout ${item.original_filename}`} title="Stáhnout originál">
                  <Icon name="download" />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="payments-empty-state">
            <span><Icon name="archive" /></span>
            <strong>Archiv je zatím prázdný</strong>
            <p>Po prvním nahrání zde najdete původní výpis i stav jeho zpracování.</p>
          </div>
        )}
      </section>
    </>
  );
}
