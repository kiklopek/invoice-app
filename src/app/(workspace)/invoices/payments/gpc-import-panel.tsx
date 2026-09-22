"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Icon } from "@/components/icons";
import { minorUnits } from "@/lib/money";
import { reconciliationError } from "@/lib/reconciliation-errors";
import { confirmAction } from "@/lib/confirm-action";

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
  bank_payment_id?: string | null;
  processing_error?: string | null;
  line_number: number;
  fingerprint: string;
  disposition: "accepted" | "ignored" | "error" | "duplicate";
  reason: string | null;
  amount: number | null;
  currency: string | null;
  booked_on: string | null;
  variable_symbol: string | null;
  counterparty_name: string | null;
  counterparty_account: string | null;
  counterparty_account_verified: boolean;
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
  progress: { booked: number; errors: number; remaining: number };
  /** Payment id -> why an unattended run booked it. Empty for human decisions. */
  match_reasons: Record<string, string>;
  import: Preview["import"];
  totals: Preview["totals"];
  total_entries: number;
  entries: PersistedPreviewEntry[];
  allocations: Array<{
    statement_entry_id: string | null;
    invoice_id: string;
    amount: number;
    is_manual_partial: boolean;
    is_committed: boolean;
  }>;
  proposal_invoices: Invoice[];
  total: number;
};
type Preview = {
  progress?: PreviewDetail["progress"];
  import: { id: string; revision: number; duplicate: boolean; status: string };
  account_mismatch: boolean;
  statement_account: string | null;
  expected_account: string | null;
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

// The matcher returns kind "exact" for "one payment, one whole invoice" -- that
// describes the SHAPE of the proposal, not how sure it is. A row proposed only
// because the amount happens to be unique is "exact" too, and labelling that
// "Přesná shoda" told the user the opposite of what the row actually needs.
// Confidence is what decides whether it books itself, so confidence is what the
// headline says; the specific evidence is right underneath in proposal_reason.
function proposalLabel(
  kind: keyof typeof labels | null,
  confidence: string | null,
) {
  if (!kind) return null;
  return confidence === "safe" ? labels[kind] : "Čeká na potvrzení";
}
const dispositionLabels = {
  accepted: "Přijato",
  ignored: "Ignorováno",
  error: "Chyba",
  duplicate: "Duplicita",
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
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, Record<string, number>>>({});
  const [partial, setPartial] = useState<Record<string, boolean>>({});
  const [previewPage, setPreviewPage] = useState(1);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [entryFilter, setEntryFilter] = useState<"all" | PreviewEntry["disposition"]>("all");
  const [filteredEntriesTotal, setFilteredEntriesTotal] = useState(0);
  const [loadedEntries, setLoadedEntries] = useState<
    Record<string, PersistedPreviewEntry>
  >({});
  const touchedEntries = useRef(new Set<string>());
  const [accountAck, setAccountAck] = useState(false);
  const [matchReasons, setMatchReasons] = useState<Record<string, string>>({});
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
  // Each statement file becomes its own separate import (own preview/review/
  // commit) -- multi-file selection just queues them so the accountant can
  // work through several statements back-to-back without re-opening the
  // file picker each time, reusing this same single-import review flow.
  const [fileQueue, setFileQueue] = useState<File[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const previewImportId = preview?.import.id;
  const importStatus = preview?.import.status;
  useEffect(() => {
    if (!previewImportId || importStatus === "committed" || working) return;
    const timer = window.setInterval(() => {
      // Never replace a user's unsaved decisions or advance their base revision.
      if (touchedEntries.current.size === 0) setRefreshVersion(value => value + 1);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [previewImportId, importStatus, working]);
  const activeImportStep =
    preview?.import.status === "committed"
      ? 4
      : preview && working
        ? 3
        : preview
          ? 2
          : 0;

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
        setMatchReasons(detail.match_reasons ?? {});
        setPreview((current) =>
          current
            ? {
                ...current,
                entries: detail.entries,
                import: touchedEntries.current.size > 0
                  ? current.import
                  : { ...current.import, ...detail.import },
                // Chybějící pole v odpovědi detailu nesmí přepsat to, co už
                // z nahrání víme. Dřív stačilo, aby API jedno pole vynechalo,
                // a `preview.totals.accepted` shodilo CELOU stránku plateb
                // do chybové hranice -- bílá obrazovka místo rozpracovaného
                // importu. Nalezeno e2e testem, který se roky přeskakoval.
                totals: detail.totals ?? current.totals,
                progress: detail.progress ?? current.progress,
                total_entries: detail.total_entries ?? current.total_entries,
                proposal_invoices: detail.proposal_invoices ?? current.proposal_invoices,
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
        setAllocationAmounts(current => {
          const next = { ...current };
          for (const entry of detail.entries) if (!touchedEntries.current.has(entry.fingerprint)) {
            next[entry.fingerprint] = Object.fromEntries(detail.allocations.filter(a => a.statement_entry_id === entry.id).map(a => [a.invoice_id, Number(a.amount)]));
          }
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
  }, [entryFilter, previewImportId, previewPage, refreshVersion]);

  async function upload(file: File | null) {
    setError("");
    setDone("");
    setPreview(null);
    setSelected({});
    setAllocationAmounts({});
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

  function continueQueue() {
    const nextIndex = queueIndex + 1;
    if (nextIndex >= fileQueue.length) {
      setFileQueue([]);
      setQueueIndex(0);
      return;
    }
    setQueueIndex(nextIndex);
    void upload(fileQueue[nextIndex]);
  }

  function allocationInfo(entry: PreviewEntry) {
    const ids = selected[entry.fingerprint] ?? [];
    const paymentAmount = Number(entry.amount ?? 0);
    const values = ids
      .map((id) => invoiceById.get(id))
      .filter((invoice): invoice is Invoice => Boolean(invoice));
    let allocated = values.reduce(
      (sum, invoice) =>
        sum + (allocationAmounts[entry.fingerprint]?.[invoice.id] ?? Math.max(0, minorUnits(invoice.amount) - minorUnits(invoice.paid_amount)) / 100),
      0,
    );
    if (partial[entry.fingerprint] && values.length === 1)
      allocated = Math.min(allocated, paymentAmount);
    return { values, allocated: minorUnits(allocated) / 100, difference: (minorUnits(paymentAmount) - minorUnits(allocated)) / 100 };
  }

  /**
   * Take back a row the automation booked, so it can be assigned by hand.
   * The server reverses the invoice, removes the payment record and pins the
   * row to manual review -- without that last part the next unattended pass
   * would simply book the same answer again.
   */
  async function releaseEntry(entry: PersistedPreviewEntry) {
    if (!preview) return;
    setWorking(true);
    setError("");
    setDone("");
    try {
      await apiFetch(`/api/payments/imports/${preview.import.id}/release`, {
        method: "POST",
        body: JSON.stringify({ entry_id: entry.id }),
      });
      touchedEntries.current.delete(entry.fingerprint);
      setDone(`Řádek ${entry.line_number} byl uvolněn. Faktura je zpět mezi neuhrazenými a přiřazení můžete změnit.`);
      setRefreshVersion((value) => value + 1);
      onCommitted();
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.message
          : "Řádek se nepodařilo uvolnit.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function commit() {
    if (!preview) return;
    const reviewedEntries = Object.values(loadedEntries).filter(
      (entry) => entry.disposition === "accepted" && !entry.bank_payment_id,
    );
    const invalid = reviewedEntries.find(
      (entry) =>
        (selected[entry.fingerprint]?.length ?? 0) > 0 &&
        (minorUnits(allocationInfo(entry).difference) < 0 ||
          (!partial[entry.fingerprint] && minorUnits(allocationInfo(entry).difference) !== 0)),
    );
    if (invalid) {
      setError(
        `Řádek ${invalid.line_number}: součet vybraných faktur neodpovídá platbě. Upravte výběr nebo výslovně zvolte částečnou úhradu.`,
      );
      return;
    }
    // Tohle zapisuje peníze na faktury a je to nevratné jinak než uvolněním
    // po jedné. Mazání faktury přitom potvrzovací dialog má -- ta
    // nekonzistence je horší než absence: uživatel si zvykne, že nebezpečné
    // akce se ptají, a tady se nezeptá nic.
    const bookedCount = reviewedEntries.filter(
      (entry) => (selected[entry.fingerprint]?.length ?? 0) > 0,
    ).length;
    if (!(await confirmAction({
      title: "Zaúčtovat platby k fakturám?",
      description: bookedCount
        ? `Potvrzením se ${bookedCount} platba(y) zapíše k vybraným fakturám a změní jejich uhrazenou částku. Vrátit to lze jen uvolněním jednotlivých plateb.`
        : "Potvrzením se import uzavře. Vrátit to lze jen uvolněním jednotlivých plateb.",
      confirmLabel: "Zaúčtovat",
    }))) return;
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
              : allocationAmounts[entry.fingerprint]?.[invoice.id] ?? Math.max(
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
      const result = await apiFetch<{ imported: number; matched: number; status: string; revision: number; remaining: number; errors: { line_number: number; code: string }[] }>(
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
        `${result.status === "committed" ? "Import je dokončený" : "Průběh byl uložen"}: ${result.imported} plateb, ${result.matched} přiřazených položek.${result.remaining ? ` Zbývá ${result.remaining} položek.` : ""}`,
      );
      if (result.errors?.length) setError(result.errors.map(item => `Řádek ${item.line_number}: ${reconciliationError(item.code).error}`).join(" "));
      setPreview((current) =>
        current
          ? {
              ...current,
              import: {
                ...current.import,
                status: result.status,
                revision: result.revision,
              },
            }
          : current,
      );
      onCommitted();
      const updated = await apiFetch<PreviewDetail>(`/api/payments/imports/${preview.import.id}?page=${previewPage}`);
      setPreview(current => current ? { ...current, import: updated.import, entries: updated.entries, totals: updated.totals, total_entries: updated.total_entries } : current);
      setLoadedEntries(Object.fromEntries(updated.entries.map(entry => [entry.fingerprint, entry])));
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
        {!preview ? (
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
                  multiple
                  accept=".gpc,.csv,application/octet-stream,text/plain,text/csv"
                  disabled={!canManage || working}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    if (!files.length) return;
                    setFileQueue(files);
                    setQueueIndex(0);
                    void upload(files[0]);
                  }}
                />
                <span className="gpc-dropzone-icon"><Icon name="upload" /></span>
                <strong>{working ? "Analyzuji výpis…" : selectedFilename || "Vyberte soubor (lze i více najednou)"}</strong>
                <small>{canManage ? "Klikněte a vyberte soubor z počítače" : "Import vyžaduje roli účetní nebo administrátor"}</small>
                {fileQueue.length > 1 && <small className="gpc-queue-progress">Výpis {Math.min(queueIndex + 1, fileQueue.length)} z {fileQueue.length}</small>}
              </label>
            </div>
            <aside className="gpc-safety-card">
              <span className="gpc-safety-icon"><Icon name="check" /></span>
              <h3>Nejdřív kontrola, potom zápis</h3>
              <ol>
                <li><strong>Nejprve vyhodnocení.</strong><span>Ve stínovém režimu se úhrady zapisují až po potvrzení. Zapnutý automat zpracuje jednoznačné shody na pozadí.</span></li>
                <li><strong>Sporné platby zůstanou ruční.</strong><span>U každé položky vidíte důvod návrhu i případný konflikt.</span></li>
                <li><strong>Každá úhrada samostatně.</strong><span>Chybná položka nezruší již dokončené nezávislé úhrady.</span></li>
              </ol>
            </aside>
          </div>
        ) : (
          <div className="gpc-file-summary">
            <span className="gpc-file-summary-icon"><Icon name="document" /></span>
            <div className="gpc-file-summary-copy">
              <strong>{selectedFilename}</strong>
              <small>{["Soubor", "Náhled", "Kontrola", "Potvrzení", "Výsledek"][activeImportStep]}{fileQueue.length > 1 ? ` · Výpis ${Math.min(queueIndex + 1, fileQueue.length)} z ${fileQueue.length}` : ""}</small>
            </div>
            {/* Available whenever nothing is running, not only before the first
                commit: a statement that keeps some rows for review never reaches
                "committed", and used to trap the user on it with no way back. */}
            {!working && (
              <button
                type="button"
                className="btn secondary gpc-change-file"
                onClick={async () => {
                  if (
                    touchedEntries.current.size > 0 &&
                    !(await confirmAction({
                      title: "Opustit rozpracovaný výpis?",
                      description: "Nepotvrzené změny v přiřazení faktur se zahodí. Už zaúčtované platby zůstávají.",
                      confirmLabel: "Nahrát jiný soubor",
                    }))
                  )
                    return;
                  setFileQueue([]);
                  setQueueIndex(0);
                  void upload(null);
                }}
                disabled={working}
              >
                Nahrát jiný soubor
              </button>
            )}
          </div>
        )}
        <div className="gpc-progress-wrap">
          <span>Průběh zpracování</span>
          <div className="import-steps" aria-label="Průběh importu">
            {["Soubor", "Náhled", "Kontrola", "Potvrzení", "Výsledek"].map(
              (step, index) => (
                <span
                  className={[
                    index <= activeImportStep ? "active" : "",
                    index === activeImportStep ? "current" : "",
                  ].filter(Boolean).join(" ")}
                  aria-current={index === activeImportStep ? "step" : undefined}
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
        {preview?.import.status === "committed" && queueIndex + 1 < fileQueue.length && (
          <button type="button" className="btn primary gpc-queue-next" onClick={continueQueue}>
            Pokračovat dalším výpisem ({queueIndex + 2} z {fileQueue.length})
          </button>
        )}
        {/* A finished statement used to be a dead end: the "change file" button
            hides once work starts, and the queue button only exists when several
            files were picked at once. So after committing a single statement
            there was no way back to the upload screen short of reloading. */}
        {preview?.import.status === "committed" && queueIndex + 1 >= fileQueue.length && (
          <button
            type="button"
            className="btn primary gpc-queue-next"
            disabled={working}
            onClick={() => {
              setFileQueue([]);
              setQueueIndex(0);
              void upload(null);
            }}
          >
            Nahrát další výpis
          </button>
        )}
        {preview && (
          <div className="gpc-preview">
            {preview.import.duplicate && (
              <p className="form-success">
                Tento výpis už byl dříve nahraný. Zobrazujeme jeho existující náhled.
              </p>
            )}
            {preview.account_mismatch && (
              <div className="account-warning" role="alert">
                <span className="account-warning-icon">
                  <Icon name="alert" />
                </span>
                <span className="account-warning-copy">
                  <strong>Účet ve výpisu nesouhlasí s nastaveným firemním účtem v této měně</strong>
                  <span className="account-warning-numbers">
                    <span>Ve výpisu: <strong>{preview.statement_account || "neznámý"}</strong></span>
                    <span>Nastaveno: <strong>{preview.expected_account || "neznámý"}</strong></span>
                  </span>
                </span>
                <label className="account-warning-confirm">
                  <input
                    type="checkbox"
                    checked={accountAck}
                    onChange={(event) => setAccountAck(event.target.checked)}
                  />
                  <span className="account-warning-check" aria-hidden="true">
                    <Icon name="check" />
                  </span>
                  <span className="account-warning-confirm-text">
                    {accountAck ? "Soubor ověřen" : "Potvrdit kontrolu"}
                  </span>
                </label>
              </div>
            )}
            <div className="payment-result">
              <div>
                <span>Přijaté</span>
                <strong>{preview.totals.accepted}</strong>
                <small>Příchozí CZK platby připravené ke kontrole.</small>
              </div>
              <div>
                <span>Ignorované</span>
                <strong>{preview.totals.ignored}</strong>
                <small>Odchozí, cizoměnové nebo duplicitní řádky.</small>
              </div>
              <div>
                <span>Chyby</span>
                <strong>{preview.totals.errors}</strong>
                <small>Řádky s neplatným nebo neúplným formátem.</small>
              </div>
              <div>
                <span>Celkem</span>
                <strong>{preview.total_entries}</strong>
                <small>Všechny nalezené řádky ve výpisu.</small>
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
                const hasReviewableProposal =
                  entry.disposition === "accepted" &&
                  !entry.bank_payment_id &&
                  entry.proposed_invoice_ids.length > 0 &&
                  entry.proposal_confidence !== "safe";
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
                          : dispositionLabels[entry.disposition]}
                      </span>
                    </header>
                    <p>
                      VS {entry.variable_symbol || "—"} ·{" "}
                      {proposalLabel(
                        entry.proposal_kind,
                        entry.proposal_confidence,
                      ) ?? entry.reason}
                    </p>
                    {entry.counterparty_account && (
                      <p className={entry.counterparty_account_verified ? undefined : "gpc-account-unverified"}>
                        Účet {entry.counterparty_account}
                        {!entry.counterparty_account_verified && (
                          <small> · kontrolní součet čísla účtu nesedí, ověřte ručně</small>
                        )}
                      </p>
                    )}
                    {hasReviewableProposal ? (
                      <div className="gpc-proposal-row">
                        {entry.proposal_reason ? <small>{entry.proposal_reason}</small> : null}
                        <button
                          type="button"
                          className="btn secondary compact gpc-proposal-button"
                          onClick={() => {
                            touchedEntries.current.add(entry.fingerprint);
                            setSelected((current) => ({
                              ...current,
                              [entry.fingerprint]: entry.proposed_invoice_ids,
                            }));
                          }}
                        >
                          Použít navrženou kombinaci
                        </button>
                      </div>
                    ) : entry.proposal_reason ? (
                      <small>{entry.proposal_reason}</small>
                    ) : null}
                    {entry.bank_payment_id && (
                      <div className="gpc-entry-booked">
                        <p>
                          <strong>Zaúčtováno</strong>
                          {(selected[entry.fingerprint] ?? [])
                            .map((invoiceId) => invoiceById.get(invoiceId))
                            .filter((invoice): invoice is Invoice => Boolean(invoice))
                            .map((invoice) => ` · ${invoice.invoice_number} (${invoice.counterparty_name})`)
                            .join("")}
                        </p>
                        {/* Only an unattended run leaves a reason, so its presence
                            is itself the signal that nobody reviewed this row. */}
                        {matchReasons[entry.bank_payment_id] && (
                          <small>Automaticky · {matchReasons[entry.bank_payment_id]}</small>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            className="btn secondary compact gpc-release-button"
                            aria-label="Uvolnit platbu a přiřadit ji jinak"
                            // The persisted row carries the database id; the
                            // upload response's rows do not.
                            disabled={working || !loadedEntries[entry.fingerprint]}
                            onClick={() => {
                              const persisted = loadedEntries[entry.fingerprint];
                              if (persisted) void releaseEntry(persisted);
                            }}
                          >
                            Změnit přiřazení
                          </button>
                        )}
                      </div>
                    )}
                    {entry.processing_error && <p role="alert">{reconciliationError(entry.processing_error).error}</p>}
                    {entry.disposition === "accepted" &&
                      entry.proposal_confidence === "safe" &&
                      entry.proposed_invoice_ids.length > 0 && (
                        <p className="gpc-entry-matched-invoice">
                          →{" "}
                          {entry.proposed_invoice_ids
                            .map((id) => invoiceById.get(id))
                            .filter((invoice): invoice is Invoice => Boolean(invoice))
                            .map((invoice) => `${invoice.invoice_number} · ${invoice.counterparty_name}`)
                            .join(", ")}
                        </p>
                      )}
                    {entry.disposition === "accepted" && !entry.bank_payment_id && (
                      <>
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
                          {info.values.map(invoice => <label className="gpc-allocation-field" key={`amount-${invoice.id}`}>
                            <span>Přiřadit k faktuře {invoice.invoice_number}</span>
                            <input type="number" min="0.01" step="0.01" max={Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount))}
                              value={allocationAmounts[entry.fingerprint]?.[invoice.id] ?? Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount))}
                              onChange={event => {
                                touchedEntries.current.add(entry.fingerprint);
                                const value = Number(event.target.value);
                                setAllocationAmounts(current => ({ ...current, [entry.fingerprint]: { ...current[entry.fingerprint], [invoice.id]: value } }));
                              }}/>
                          </label>)}
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
              <div className="gpc-confirm-bar">
                <span>Potvrzením se platby zapíšou k vybraným fakturám.</span>
                <button
                  className="btn primary import-confirm"
                  disabled={working || (preview.account_mismatch && !accountAck)}
                  onClick={commit}
                >
                  {working ? "Potvrzuji…" : "Uložit kontrolu a potvrdit import"}
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      <section className="page-panel data-panel import-archive" id="archiv-vypisu">
        <header className="panel-head">
          <span className="payments-section-number">03</span>
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
