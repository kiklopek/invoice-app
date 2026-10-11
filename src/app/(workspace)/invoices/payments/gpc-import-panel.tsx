"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Icon } from "@/components/icons";
import { reconciliationError } from "@/lib/reconciliation-errors";
import { confirmAction } from "@/lib/confirm-action";
import { buildStatementReviewSubmission } from "@/lib/payment-unrelated-rows";
import { reviewAllocations as allocationsFor, reviewPayment, summarize, type ReviewChoice } from "@/lib/payment-review-model";
import { commitSummary, commitTitle, REVIEW_COPY } from "@/lib/payment-review-copy";
import { useAccessRole } from "@/lib/use-access-role";
import { canEditCompanySettings } from "@/lib/role-access";
import { InvoicePicker } from "./review/invoice-picker";
import { PaymentCard } from "./review/payment-card";
import { ReviewSummary, type ReviewFilter } from "./review/review-summary";
import { CommitBar } from "./review/commit-bar";
import { AccountQuestion, type AccountAnswer } from "./review/account-question";
import type { Invoice, PersistedPreviewEntry, Preview, PreviewDetail, PreviewEntry } from "./review/types";
import styles from "./review/payment-review.module.css";

const PAGE_SIZE = 50;
const IMPORT_STEPS = ["Soubor", "Kontrola plateb", "Zaúčtování", "Hotovo"];
const INVALID_AMOUNTS = new Set(["underpaid", "overpaid", "over_allocated"]);

/** Chybová hláška pro člověka; kód pro podporu zvlášť a nenápadně. */
function errorParts(cause: unknown, fallback: string) {
  return {
    message: cause instanceof Error && cause.message ? cause.message : fallback,
    reference: cause instanceof ApiRequestError && cause.requestId ? cause.requestId : "",
  };
}

export function GpcImportPanel({
  invoices,
  canManage,
  onCommitted,
  camtEnabled = false,
}: {
  invoices: Invoice[];
  canManage: boolean;
  onCommitted: () => void;
  camtEnabled?: boolean;
}) {
  const role = useAccessRole();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, Record<string, number>>>({});
  // Fingerprint -> přeplatek odsouhlasený uživatelem (is_manual_partial).
  const [partial, setPartial] = useState<Record<string, boolean>>({});
  // Fingerprint -> the row is "Nesouvisí s fakturami" and must not be booked.
  const [unrelated, setUnrelated] = useState<Record<string, boolean>>({});
  const [leftUnmatched, setLeftUnmatched] = useState<Record<string, boolean>>({});
  const [duplicateSkipped, setDuplicateSkipped] = useState<Record<string, boolean>>({});
  // Entry id -> why the row looks like a transfer between own accounts.
  const [ownTransfers, setOwnTransfers] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState<Record<string, boolean>>({});
  const [previewPage, setPreviewPage] = useState(1);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [filter, setFilter] = useState<ReviewFilter | null>(null);
  // Karty, na které uživatel sáhl, zůstávají vidět i po přesunu do jiného
  // stavu -- jinak by mu odpověď zmizela pod rukama.
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());
  const [filteredEntriesTotal, setFilteredEntriesTotal] = useState(0);
  const [loadedEntries, setLoadedEntries] = useState<Record<string, PersistedPreviewEntry>>({});
  const touchedEntries = useRef(new Set<string>());
  const [accountAnswer, setAccountAnswer] = useState<AccountAnswer>(null);
  const [matchReasons, setMatchReasons] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [errorReference, setErrorReference] = useState("");
  const [done, setDone] = useState("");
  const [invoiceById, setInvoiceById] = useState<Map<string, Invoice>>(
    () => new Map(invoices.map((invoice) => [invoice.id, invoice])),
  );
  const [selectedFilename, setSelectedFilename] = useState("");
  // Each statement file becomes its own separate import (own preview/review/
  // commit) -- multi-file selection just queues them so the accountant can
  // work through several statements back-to-back without re-opening the
  // file picker each time, reusing this same single-import review flow.
  const [fileQueue, setFileQueue] = useState<File[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const previewImportId = preview?.import.id;
  const importStatus = preview?.import.status;
  const committed = importStatus === "committed";

  function showError(cause: unknown, fallback: string) {
    const parts = errorParts(cause, fallback);
    setError(parts.message);
    setErrorReference(parts.reference);
  }
  function clearMessages() {
    setError("");
    setErrorReference("");
    setDone("");
  }
  function rememberInvoices(list: Invoice[]) {
    if (!list.length) return;
    setInvoiceById((current) => new Map([...current, ...list.map((invoice) => [invoice.id, invoice] as const)]));
  }
  function touch(fingerprint: string) {
    touchedEntries.current.add(fingerprint);
    setPinned((current) => (current.has(fingerprint) ? current : new Set(current).add(fingerprint)));
  }

  useEffect(() => {
    if (!previewImportId || importStatus === "committed" || working) return;
    const timer = window.setInterval(() => {
      // Never replace a user's unsaved decisions or advance their base revision.
      if (touchedEntries.current.size === 0) setRefreshVersion((value) => value + 1);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [previewImportId, importStatus, working]);

  // „Pokračovat v kontrole“ z archivu: /invoices/payments?import=<id>.
  useEffect(() => {
    const importId = new URLSearchParams(window.location.search).get("import");
    if (!importId || !/^[0-9a-f-]{36}$/i.test(importId)) return;
    let active = true;
    setWorking(true);
    apiFetch<PreviewDetail>(`/api/payments/imports/${importId}?page=1`)
      .then((detail) => {
        if (!active) return;
        setSelectedFilename(detail.import.original_filename ?? "Bankovní výpis");
        setFilteredEntriesTotal(detail.total);
        setPreview({
          import: detail.import,
          account_mismatch: Boolean(detail.import.account_mismatch) && detail.import.status !== "committed",
          statement_account: detail.import.statement_account ?? null,
          expected_account: detail.expected_account ?? null,
          statement_bank: null,
          totals: detail.totals,
          entries: detail.entries,
          proposal_invoices: detail.proposal_invoices ?? [],
          total_entries: detail.total_entries,
          request_id: "",
          progress: detail.progress,
        });
      })
      .catch((cause) => active && showError(cause, "Výpis se nepodařilo otevřít."))
      .finally(() => active && setWorking(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!previewImportId) return;
    let active = true;
    apiFetch<PreviewDetail>(`/api/payments/imports/${previewImportId}?page=${previewPage}`)
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
        rememberInvoices(detail.proposal_invoices ?? []);
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
        setAllocationAmounts((current) => {
          const next = { ...current };
          for (const entry of detail.entries) if (!touchedEntries.current.has(entry.fingerprint)) {
            next[entry.fingerprint] = Object.fromEntries(detail.allocations.filter((a) => a.statement_entry_id === entry.id).map((a) => [a.invoice_id, Number(a.amount)]));
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
        const detectedOwnTransfers = detail.own_transfers ?? {};
        setOwnTransfers((current) => ({ ...current, ...detectedOwnTransfers }));
        setUnrelated((current) => {
          const next = { ...current };
          for (const entry of detail.entries) {
            if (touchedEntries.current.has(entry.fingerprint)) continue;
            // A saved decision wins. Otherwise an own transfer is only
            // PRE-selected, and only when no invoice evidence competes with
            // it -- with a proposal or allocation on the row, two sources
            // disagree and the row stays as it is, reason shown, for a person.
            next[entry.fingerprint] = Boolean(entry.unrelated_at) || (
              !entry.bank_payment_id &&
              entry.disposition === "accepted" &&
              Boolean(detectedOwnTransfers[entry.id]) &&
              entry.proposed_invoice_ids.length === 0 &&
              !allocationsByEntry.has(entry.id)
            );
          }
          return next;
        });
      })
      .catch((cause) => {
        if (active) showError(cause, "Platby z výpisu se nepodařilo načíst.");
      });
    return () => {
      active = false;
    };
  }, [previewImportId, previewPage, refreshVersion]);

  async function upload(file: File | null) {
    clearMessages();
    setPreview(null);
    setSelected({});
    setAllocationAmounts({});
    setPartial({});
    setUnrelated({});
    setLeftUnmatched({});
    setDuplicateSkipped({});
    setOwnTransfers({});
    setPickerOpen({});
    setPinned(new Set());
    setFilter(null);
    setPreviewPage(1);
    setFilteredEntriesTotal(0);
    setLoadedEntries({});
    touchedEntries.current.clear();
    setAccountAnswer(null);
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
      rememberInvoices(data.proposal_invoices ?? []);
    } catch (cause) {
      showError(cause, "Výpis se nepodařilo nahrát.");
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

  function choiceFor(entry: PreviewEntry): ReviewChoice {
    const persisted = loadedEntries[entry.fingerprint];
    return {
      selectedIds: selected[entry.fingerprint] ?? [],
      amounts: allocationAmounts[entry.fingerprint],
      overpaymentAccepted: Boolean(partial[entry.fingerprint]),
      unrelated: Boolean(unrelated[entry.fingerprint]),
      duplicateSkipped: Boolean(duplicateSkipped[entry.fingerprint]),
      leftUnmatched: Boolean(leftUnmatched[entry.fingerprint]),
      ownTransferReason: persisted ? ownTransfers[persisted.id] : null,
      autoReason: entry.bank_payment_id ? matchReasons[entry.bank_payment_id] : null,
    };
  }

  const reviews = useMemo(
    () => new Map((preview?.entries ?? []).map((entry) => [entry.fingerprint, reviewPayment(entry, choiceFor(entry), invoiceById)])),
    // choiceFor reads the state listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview?.entries, selected, allocationAmounts, partial, unrelated, duplicateSkipped, leftUnmatched, ownTransfers, matchReasons, loadedEntries, invoiceById],
  );
  const counts = summarize([...reviews.values()]);
  const activeFilter: ReviewFilter = filter ?? (counts.needs_answer > 0 ? "needs_answer" : "all");
  const visibleEntries = (preview?.entries ?? []).filter(
    (entry) => activeFilter === "all" || reviews.get(entry.fingerprint)?.bucket === activeFilter || pinned.has(entry.fingerprint),
  );
  const openEntries = Object.values(loadedEntries).filter((entry) => entry.disposition === "accepted" && !entry.bank_payment_id);
  const bookCount = openEntries.filter((entry) => !unrelated[entry.fingerprint] && (selected[entry.fingerprint]?.length ?? 0) > 0).length;
  const confirmBlockedReason =
    preview?.account_mismatch && !accountAnswer
      ? "Nejdřív odpovězte na otázku k bankovnímu účtu nahoře."
      : null;
  const activeImportStep = committed ? 3 : preview && working ? 2 : preview ? 1 : 0;

  function changeFilter(next: ReviewFilter) {
    setFilter(next);
    setPinned(new Set());
  }

  function updateChoice(entry: PreviewEntry, change: () => void) {
    touch(entry.fingerprint);
    change();
  }

  function setInvoices(entry: PreviewEntry, ids: string[]) {
    updateChoice(entry, () => {
      setSelected((current) => ({ ...current, [entry.fingerprint]: ids }));
      setLeftUnmatched((current) => ({ ...current, [entry.fingerprint]: false }));
      setPartial((current) => ({ ...current, [entry.fingerprint]: false }));
      setAllocationAmounts((current) => ({ ...current, [entry.fingerprint]: {} }));
    });
  }

  function markUnrelated(entry: PreviewEntry, next: boolean, asDuplicate = false) {
    updateChoice(entry, () => {
      setUnrelated((current) => ({ ...current, [entry.fingerprint]: next }));
      setDuplicateSkipped((current) => ({ ...current, [entry.fingerprint]: next && asDuplicate }));
      if (next) {
        // Marking a row unrelated drops its invoice choice in the same
        // visible step; the two answers can never be sent together.
        setSelected((current) => ({ ...current, [entry.fingerprint]: [] }));
        setPartial((current) => ({ ...current, [entry.fingerprint]: false }));
        setAllocationAmounts((current) => ({ ...current, [entry.fingerprint]: {} }));
        setLeftUnmatched((current) => ({ ...current, [entry.fingerprint]: false }));
        setPickerOpen((current) => ({ ...current, [entry.fingerprint]: false }));
      }
    });
  }

  async function acknowledgeOverlap(entry: PreviewEntry) {
    const persisted = loadedEntries[entry.fingerprint];
    if (!persisted || !preview) return;
    setWorking(true);
    clearMessages();
    try {
      const result = await apiFetch<{ revision: number }>("/api/payments/imports/overlap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entry_id: persisted.id, revision: preview.import.revision }),
      });
      touch(entry.fingerprint);
      setPreview((current) => current ? {
        ...current,
        import: { ...current.import, revision: result.revision },
        entries: current.entries.map((row) => row.fingerprint === entry.fingerprint ? { ...row, overlap_acknowledged_by: "confirmed" } : row),
      } : current);
    } catch (cause) {
      showError(cause, "Odpověď se nepodařilo uložit.");
    } finally {
      setWorking(false);
    }
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
    clearMessages();
    try {
      await apiFetch(`/api/payments/imports/${preview.import.id}/release`, {
        method: "POST",
        body: JSON.stringify({ entry_id: entry.id }),
      });
      touchedEntries.current.delete(entry.fingerprint);
      setPinned((current) => new Set(current).add(entry.fingerprint));
      setDone(`Platba od ${entry.counterparty_name || "neuvedeného plátce"} je odpárovaná. Faktura je zpět mezi neuhrazenými a platbu můžete přiřadit jinak.`);
      setRefreshVersion((value) => value + 1);
      onCommitted();
    } catch (cause) {
      showError(cause, "Platbu se nepodařilo odpárovat.");
    } finally {
      setWorking(false);
    }
  }

  async function addStatementAccount() {
    if (!preview?.statement_account) return;
    setWorking(true);
    clearMessages();
    try {
      const currency = preview.entries.find((entry) => entry.currency)?.currency ?? "CZK";
      await apiFetch("/api/settings/bank-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: preview.statement_account, currency, label: "Přidáno při kontrole výpisu" }),
      });
      setAccountAnswer("added");
    } catch (cause) {
      showError(cause, "Účet se nepodařilo přidat. Můžete výpis zpracovat jen tentokrát.");
    } finally {
      setWorking(false);
    }
  }

  async function discardStatement() {
    if (!preview) return;
    if (!(await confirmAction({
      title: "Zahodit tento výpis?",
      description: "Výpis se nezpracuje a žádná platba z něj se nezapíše k fakturám. Původní soubor zůstane v archivu výpisů.",
      confirmLabel: "Zahodit výpis",
    }))) return;
    setWorking(true);
    clearMessages();
    try {
      await apiFetch(`/api/payments/imports/${preview.import.id}/discard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: preview.import.revision, reason: "Výpis z účtu, který nepatří firmě" }),
      });
      await upload(null);
      setDone("Výpis byl zahozen. Žádná platba se nezapsala.");
    } catch (cause) {
      showError(cause, "Výpis se nepodařilo zahodit.");
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
        !unrelated[entry.fingerprint] &&
        (selected[entry.fingerprint]?.length ?? 0) > 0 &&
        INVALID_AMOUNTS.has(reviewPayment(entry, choiceFor(entry), invoiceById).status),
    );
    if (invalid) {
      setError(
        `Platba od ${invalid.counterparty_name || "neuvedeného plátce"}: částka nesedí s vybranými fakturami. Odpovězte na otázku u platby.`,
      );
      setErrorReference("");
      changeFilter("needs_answer");
      return;
    }
    const submission = buildStatementReviewSubmission({
      entries: reviewedEntries,
      unrelated,
      allocationsFor: (entry) => allocationsFor(entry, choiceFor(entry), invoiceById),
    });
    if (!submission.ok) {
      setError(submission.error);
      setErrorReference("");
      return;
    }
    const bookedEntries = reviewedEntries.filter((entry) => !unrelated[entry.fingerprint] && (selected[entry.fingerprint]?.length ?? 0) > 0);
    const invoiceCount = new Set(bookedEntries.flatMap((entry) => selected[entry.fingerprint] ?? [])).size;
    const unrelatedCount = submission.unrelated_entry_ids.length;
    // Tohle zapisuje peníze na faktury a je to nevratné jinak než
    // odpárováním po jedné. Dialog proto říká přesný rozsah dopadu.
    if (!(await confirmAction({
      title: commitTitle(bookedEntries.length, invoiceCount),
      description: commitSummary({
        booked: bookedEntries.length,
        invoices: invoiceCount,
        unmatched: reviewedEntries.length - bookedEntries.length - unrelatedCount,
        unrelated: unrelatedCount,
      }),
      confirmLabel: "Zaúčtovat",
      confirmVariant: "primary",
    }))) return;
    setWorking(true);
    clearMessages();
    try {
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
            reviewed_entry_ids: submission.reviewed_entry_ids,
            unrelated_entry_ids: submission.unrelated_entry_ids,
            allocations: submission.allocations,
          }),
        },
      );
      const result = await apiFetch<{ imported: number; matched: number; status: string; revision: number; remaining: number; unrelated?: number; errors: { line_number: number; code: string }[] }>(
        `/api/payments/imports/${preview.import.id}/commit`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": `commit-${preview.import.id}`,
          },
          body: JSON.stringify({
            revision: saved.revision,
            acknowledge_account_mismatch: Boolean(accountAnswer),
          }),
        },
        45_000,
      );
      const completed = result.status === "committed" && result.remaining === 0 && !result.errors?.length;
      setDone(
        `${result.status === "committed" ? "Výpis je zaúčtovaný" : "Průběh byl uložen"}: ${result.imported} plateb, ${result.matched} přiřazení k fakturám.${result.unrelated ? ` ${result.unrelated} řádků nesouvisí s fakturami a jako platby se nezapsaly.` : ""}${result.remaining ? ` Zbývá ${result.remaining} plateb.` : ""}`,
      );
      if (result.errors?.length) {
        const byLine = new Map(Object.values(loadedEntries).map((entry) => [entry.line_number, entry]));
        setError(result.errors.map((item) => `Řádek ${item.line_number}${byLine.get(item.line_number)?.counterparty_name ? ` (${byLine.get(item.line_number)?.counterparty_name})` : ""}: ${reconciliationError(item.code).error}`).join(" "));
      }
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
      if (completed) {
        await upload(null);
        setDone("Import proběhl úspěšně.");
        if (queueIndex + 1 >= fileQueue.length) {
          setFileQueue([]);
          setQueueIndex(0);
        }
      } else {
        touchedEntries.current.clear();
        const updated = await apiFetch<PreviewDetail>(`/api/payments/imports/${preview.import.id}?page=${previewPage}`);
        setPreview((current) => current ? { ...current, import: updated.import, entries: updated.entries, totals: updated.totals, total_entries: updated.total_entries } : current);
        setLoadedEntries(Object.fromEntries(updated.entries.map((entry) => [entry.fingerprint, entry])));
      }
    } catch (cause) {
      showError(cause, "Výpis se nepodařilo zaúčtovat.");
    } finally {
      setWorking(false);
    }
  }

  const pages = Math.max(1, Math.ceil(filteredEntriesTotal / PAGE_SIZE));

  return (
    <section
      className={`page-panel import-panel payment-import-panel gpc-panel${preview ? ` is-reviewing ${styles.review}` : ""}${preview || error || done ? " is-flowing" : ""}`}
      aria-labelledby="gpc-import-title"
    >
      {!preview ? (
        <div className="gpc-intro-grid">
          <div className="gpc-upload-column">
            <div className="gpc-title-row">
              <span className="payments-section-number">01</span>
              <div><span className="gpc-eyebrow">ZAČNĚTE VÝPISEM</span><h2 id="gpc-import-title">Nahrát bankovní výpis</h2></div>
            </div>
            <p className="gpc-lead">Nahrajte výpis z internetového bankovnictví. Příchozí platby porovnáme s otevřenými fakturami.</p>
            <label className={`gpc-dropzone ${working ? "is-working" : ""}`}>
              <input
                type="file"
                aria-label="Vybrat výpis z banky (soubor GPC nebo CSV)"
                multiple
                accept={camtEnabled ? ".gpc,.csv,.xml,application/octet-stream,text/plain,text/csv,application/xml,text/xml" : ".gpc,.csv,application/octet-stream,text/plain,text/csv"}
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
              <strong>{working ? "Načítám výpis…" : selectedFilename || "Výpis z banky"}</strong>
              <small>{canManage ? "Můžete vybrat jeden i více souborů najednou" : "Nahrávat výpisy může účetní nebo administrátor"}</small>
              <span className="gpc-select-file" aria-hidden="true">{working ? "Zpracovávám soubor…" : "Vybrat výpis z banky"}<Icon name="arrow-right" /></span>
              <span className="gpc-file-formats"><span>GPC</span><span>CSV</span><small>Výpis z banky (soubor GPC nebo CSV)</small></span>
              {fileQueue.length > 1 && <small className="gpc-queue-progress">Výpis {Math.min(queueIndex + 1, fileQueue.length)} z {fileQueue.length}</small>}
            </label>
            <div className="gpc-upload-note"><Icon name="check" /><span>Nic se nezapíše, dokud platby sami nezaúčtujete.</span></div>
            {error && <p className="form-error" role="alert">{error}{errorReference && <small className="gpc-error-reference">Kód pro podporu: {errorReference}</small>}</p>}
            {done && <p className="form-success" role="status">{done}</p>}
            {!preview && done && queueIndex + 1 < fileQueue.length && (
              <button type="button" className="btn primary gpc-queue-next" onClick={continueQueue}>
                Pokračovat dalším výpisem ({queueIndex + 2} z {fileQueue.length})
              </button>
            )}
          </div>
          <aside className="gpc-safety-card">
            <span className="gpc-safety-icon"><Icon name="check" /></span>
            <h3>Jak to proběhne</h3>
            <ol>
              <li><strong>Najdeme faktury k platbám</strong><span>Podle variabilního symbolu, částky a plátce. U každého návrhu uvidíte, proč ho navrhujeme.</span></li>
              <li><strong>Odpovíte jen tam, kde si nejsme jistí</strong><span>Jedním tlačítkem potvrdíte návrh, vyberete jinou fakturu, nebo platbu označíte, že s fakturami nesouvisí.</span></li>
              <li><strong>Zaúčtujete</strong><span>Platby se zapíšou k fakturám až po vašem potvrzení. Každou jde později odpárovat.</span></li>
            </ol>
          </aside>
        </div>
      ) : (
        <div className="gpc-preview">
          <header className="gpc-file-summary">
            <span className="gpc-file-summary-icon"><Icon name="document" /></span>
            <div className="gpc-file-summary-copy">
              <h2 id="gpc-import-title">Kontrola plateb z výpisu</h2>
              <p><span className="gpc-file-name" title={selectedFilename}>{selectedFilename}</span>{fileQueue.length > 1 ? <span> · výpis {Math.min(queueIndex + 1, fileQueue.length)} z {fileQueue.length}</span> : null}</p>
              <ol className="import-steps" aria-label="Postup">
                {IMPORT_STEPS.map((step, index) => (
                  <li key={step} className={index === activeImportStep ? "current" : index < activeImportStep ? "done" : undefined} aria-current={index === activeImportStep ? "step" : undefined}>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
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
                      description: "Vaše nezaúčtované odpovědi u plateb se zahodí. Už zaúčtované platby zůstávají.",
                      confirmLabel: "Nahrát jiný soubor",
                    }))
                  )
                    return;
                  setFileQueue([]);
                  setQueueIndex(0);
                  void upload(null);
                }}
              >
                Nahrát jiný soubor
              </button>
            )}
          </header>
          {error && <p className="form-error" role="alert">{error}{errorReference && <small className="gpc-error-reference">Kód pro podporu: {errorReference}</small>}</p>}
          {done && <p className="form-success" role="status">{done}</p>}
          {committed && (
            <div className="gpc-next-actions">
              {queueIndex + 1 < fileQueue.length ? (
                <button type="button" className="btn primary gpc-queue-next" onClick={continueQueue}>
                  Pokračovat dalším výpisem ({queueIndex + 2} z {fileQueue.length})
                </button>
              ) : (
                // A finished statement used to be a dead end: after committing a
                // single statement there was no way back to the upload screen.
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
            </div>
          )}
          {preview.import.duplicate && (
            <p className="form-hint gpc-notice">Tento výpis už jste dříve nahráli. Pokračujete v jeho kontrole.</p>
          )}
          {preview.account_mismatch && (
            <AccountQuestion
              statementAccount={preview.statement_account}
              expectedAccount={preview.expected_account}
              answer={accountAnswer}
              canAddAccount={canEditCompanySettings(role)}
              working={working}
              onAdd={() => void addStatementAccount()}
              onOnce={() => setAccountAnswer("once")}
              onMistake={() => void discardStatement()}
              onReset={() => setAccountAnswer(null)}
            />
          )}
          {preview.statement_bank && !preview.statement_bank.verified && (
            <p className="form-hint gpc-notice" role="status">
              {preview.statement_bank.name
                ? `Výpis z banky ${preview.statement_bank.name} zatím nemáme ověřený na vzorku.`
                : "Banku výpisu se nepodařilo určit (účet ve výpisu není mezi účty firmy)."}
              {" "}Platby párujeme jen podle variabilního symbolu a částky, ne podle čísla účtu plátce.
            </p>
          )}
          <ReviewSummary counts={counts} filter={activeFilter} total={preview.entries.length} onFilter={changeFilter} />
          <div className="gpc-entry-list">
            {preview.entries.length === 0 ? (
              <div className="payment-review-empty">
                <strong>Ve výpisu nejsou žádné platby.</strong>
                <span>Soubor neobsahuje žádný pohyb na účtu. Zkontrolujte, že jste stáhli výpis za správné období.</span>
              </div>
            ) : visibleEntries.length === 0 ? (
              <div className="payment-review-empty">
                <strong>{activeFilter === "needs_answer" ? REVIEW_COPY.allAnswered : "Tady teď nic není."}</strong>
                <button type="button" className="btn secondary review-show-all" onClick={() => changeFilter("all")}>Zobrazit všechny platby</button>
              </div>
            ) : (
              visibleEntries.map((entry) => {
                const review = reviews.get(entry.fingerprint)!;
                const persisted = loadedEntries[entry.fingerprint];
                const open = Boolean(pickerOpen[entry.fingerprint]) || (review.status === "no_match" && pickerOpen[entry.fingerprint] !== false);
                const editable = canManage && !committed && review.editable && Boolean(persisted);
                return (
                  <PaymentCard
                    key={`${entry.line_number}-${entry.fingerprint}`}
                    entry={entry}
                    review={review}
                    invoiceById={invoiceById}
                    selectedIds={selected[entry.fingerprint] ?? []}
                    editable={editable}
                    canRelease={canManage && Boolean(persisted)}
                    working={working}
                    pickerOpen={editable && open}
                    actions={{
                      accept: () => setInvoices(entry, review.suggestionIds),
                      openPicker: () => updateChoice(entry, () => setPickerOpen((current) => ({ ...current, [entry.fingerprint]: true }))),
                      setUnrelated: (next) => markUnrelated(entry, next),
                      leaveUnmatched: () => updateChoice(entry, () => {
                        setSelected((current) => ({ ...current, [entry.fingerprint]: [] }));
                        setLeftUnmatched((current) => ({ ...current, [entry.fingerprint]: true }));
                        setPickerOpen((current) => ({ ...current, [entry.fingerprint]: false }));
                      }),
                      acceptPartial: () => updateChoice(entry, () => {
                        const invoiceId = selected[entry.fingerprint]?.[0];
                        if (invoiceId) setAllocationAmounts((current) => ({ ...current, [entry.fingerprint]: { [invoiceId]: Number(entry.amount) } }));
                      }),
                      acceptOverpayment: () => updateChoice(entry, () => setPartial((current) => ({ ...current, [entry.fingerprint]: true }))),
                      overlapDifferent: () => void acknowledgeOverlap(entry),
                      overlapSame: () => markUnrelated(entry, true, true),
                      release: () => persisted && void releaseEntry(persisted),
                    }}
                    picker={
                      <InvoicePicker
                        entry={entry}
                        selectedIds={selected[entry.fingerprint] ?? []}
                        amounts={allocationAmounts[entry.fingerprint] ?? {}}
                        invoiceById={invoiceById}
                        disabled={working}
                        onLoaded={rememberInvoices}
                        onToggle={(invoiceId, checked) => {
                          const current = selected[entry.fingerprint] ?? [];
                          // Výběr zůstává otevřený, dokud ho uživatel nezavře
                          // („Hotovo“) -- i když první zaškrtnutí platbu vyřeší.
                          setPickerOpen((open) => ({ ...open, [entry.fingerprint]: true }));
                          setInvoices(entry, checked ? [...current, invoiceId] : current.filter((id) => id !== invoiceId));
                        }}
                        onAmount={(invoiceId, value) => updateChoice(entry, () =>
                          setAllocationAmounts((current) => ({ ...current, [entry.fingerprint]: { ...current[entry.fingerprint], [invoiceId]: value } })))}
                        onClose={() => setPickerOpen((current) => ({ ...current, [entry.fingerprint]: false }))}
                      />
                    }
                  />
                );
              })
            )}
          </div>
          {filteredEntriesTotal > PAGE_SIZE && (
            <nav className="candidate-pagination payment-review-pages" aria-label="Stránky výpisu">
              <button type="button" className="btn secondary" disabled={previewPage <= 1 || working} onClick={() => setPreviewPage((page) => page - 1)}>
                Předchozí platby
              </button>
              <span>Stránka {previewPage} z {pages}</span>
              <button type="button" className="btn secondary" disabled={previewPage >= pages || working} onClick={() => setPreviewPage((page) => page + 1)}>
                Další platby
              </button>
            </nav>
          )}
          {!committed && canManage && (
            <CommitBar
              remaining={counts.needs_answer}
              bookCount={bookCount}
              working={working}
              blockedReason={confirmBlockedReason}
              onCommit={() => void commit()}
            />
          )}
        </div>
      )}
    </section>
  );
}
