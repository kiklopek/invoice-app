"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { Icon } from "@/components/icons";
import { ImportProcessingView } from "@/components/import-processing-view";
import { minorUnits } from "@/lib/money";
import { reconciliationError } from "@/lib/reconciliation-errors";
import { confirmAction } from "@/lib/confirm-action";
import {
  buildStatementReviewSubmission,
} from "@/lib/payment-unrelated-rows";

import type { Invoice, PreviewEntry, PersistedPreviewEntry, PreviewDetail, Preview, ArchiveItem } from "./payment-matching-types";
import { PaymentMatchingWorkspace } from "./payment-matching-workspace";
import { MatchingNotice } from "./payment-matching-notice";
import { BankMatchingProcessInfo } from "./bank-matching-process-info";
import { allocationIsValid } from "./payment-matching-presentation";

function mergeInvoices(current: Map<string, Invoice>, values: Invoice[]) {
  const next = new Map(current);
  for (const invoice of values) next.set(invoice.id, { ...next.get(invoice.id), ...invoice });
  return next;
}

export function GpcImportPanel({
  invoices,
  canManage,
  onCommitted,
  camtEnabled = false,
  onReviewActiveChange,
}: {
  invoices: Invoice[];
  canManage: boolean;
  onCommitted: () => void;
  camtEnabled?: boolean;
  onReviewActiveChange?: (active: boolean) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, Record<string, number>>>({});
  const [partial, setPartial] = useState<Record<string, boolean>>({});
  // Fingerprint -> the row is "Nesouvisí s fakturami" and must not be booked.
  const [unrelated, setUnrelated] = useState<Record<string, boolean>>({});
  // Entry id -> why the row looks like a transfer between own accounts.
  const [ownTransfers, setOwnTransfers] = useState<Record<string, string>>({});
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
  const [uploading, setUploading] = useState(false);
  const [bookingStage, setBookingStage] = useState<0 | 1 | 2 | null>(null);
  const [confirmedRows, setConfirmedRows] = useState<Set<string>>(() => new Set());
  const mutationInFlight = useRef(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [invoicePage, setInvoicePage] = useState(1);
  const [candidateInvoices, setCandidateInvoices] = useState<Invoice[]>(
    invoices.slice(0, 25),
  );
  const [candidateTotal, setCandidateTotal] = useState(invoices.length);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const [candidateRetry, setCandidateRetry] = useState(0);
  const [invoiceById, setInvoiceById] = useState<Map<string, Invoice>>(
    () => new Map(invoices.map((invoice) => [invoice.id, invoice])),
  );
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [selectedFilename, setSelectedFilename] = useState("");
  const reviewActive = Boolean(preview || uploading || bookingStage !== null);
  useEffect(() => {
    onReviewActiveChange?.(reviewActive);
  }, [onReviewActiveChange, reviewActive]);
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
  // The only thing that disables the confirm button besides running work.
  // Shown right next to it, so a disabled button always says why.
  const confirmBlockedReason =
    preview?.account_mismatch && !accountAck
      ? "Nejdřív potvrďte kontrolu bankovního účtu ve upozornění nahoře."
      : null;
  useEffect(() => {
    apiFetch<{ imports: ArchiveItem[] }>("/api/payments/imports")
      .then((data) => setArchive(data.imports))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setCandidateLoading(true);
      void apiFetch<{ invoices: Invoice[]; total: number }>(
        `/api/payments/invoice-candidates?q=${encodeURIComponent(invoiceQuery.trim())}&page=${invoicePage}`,
      )
        .then((data) => {
          if (!active) return;
          setCandidateLoading(false); setCandidateError("");
          setCandidateInvoices(data.invoices);
          setCandidateTotal(data.total);
          setInvoiceById(
            (current) =>
              mergeInvoices(current, data.invoices),
          );
        })
        .catch(cause => { if (active) { setCandidateLoading(false); setCandidateInvoices([]); setCandidateTotal(0); setCandidateError(cause instanceof Error ? cause.message : "Faktury se nepodařilo načíst."); } });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [invoicePage, invoiceQuery, candidateRetry]);

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
            mergeInvoices(current, detail.proposal_invoices),
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
    setConfirmedRows(new Set());
    setPreview(null);
    setSelected({});
    setAllocationAmounts({});
    setPartial({});
    setUnrelated({});
    setOwnTransfers({});
    setPreviewPage(1);
    setEntryFilter("all");
    setFilteredEntriesTotal(0);
    setLoadedEntries({});
    touchedEntries.current.clear();
    setAccountAck(false);
    setSelectedFilename(file?.name ?? "");
    if (!file) return;
    setUploading(true);
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
          mergeInvoices(current, data.proposal_invoices ?? []),
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
      setUploading(false);
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
    if (!preview || !canManage || working || mutationInFlight.current) return;
    mutationInFlight.current = true;
    setWorking(true);
    setError("");
    setDone("");
    try {
      await apiFetch(`/api/payments/imports/${preview.import.id}/release`, {
        method: "POST",
        body: JSON.stringify({ entry_id: entry.id }),
      });
      touchedEntries.current.delete(entry.fingerprint);
      // Releasing a booked payment restores the invoice balance on the server.
      // Refresh candidates too: the parent props and the last search can still
      // omit that invoice or contain its previously paid balance.
      setCandidateLoading(true);
      setCandidateError("");
      setCandidateRetry(value => value + 1);
      setConfirmedRows(current => {
        const next = new Set(current);
        next.delete(entry.fingerprint);
        return next;
      });
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
      mutationInFlight.current = false;
      setWorking(false);
    }
  }

  /** The allocations a reviewed row will be saved with, from the current choices. */
  function reviewAllocations(entry: PreviewEntry) {
    const info = allocationInfo(entry);
    return info.values.map((invoice, index) => ({
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
  }

  /** What confirming will do, row by row kind -- said before it happens. */
  function commitOutcome(reviewedEntries: PreviewEntry[], unrelatedCount: number) {
    const bookedCount = reviewedEntries.filter(
      (entry) => !unrelated[entry.fingerprint] && (selected[entry.fingerprint]?.length ?? 0) > 0,
    ).length;
    const unmatchedCount = reviewedEntries.length - bookedCount - unrelatedCount;
    const outcome = [
      bookedCount ? `${bookedCount} platba(y) se zapíše k vybraným fakturám a změní jejich uhrazenou částku.` : "",
      unmatchedCount ? `${unmatchedCount} platba(y) bez faktury se uloží jako nespárovaná.` : "",
      unrelatedCount ? `${unrelatedCount} řádek(y) označený „Nesouvisí s fakturami“ se jako platba nezapíše.` : "",
    ].filter(Boolean).join(" ");
    return `${outcome ? `${outcome} ` : "Potvrzením se import uzavře. "}Vrátit to lze jen uvolněním jednotlivých plateb.`;
  }

  async function commit() {
    if (!preview || !canManage || working || mutationInFlight.current || confirmBlockedReason) return;
    mutationInFlight.current = true;
    try { await commitImport(); } finally { mutationInFlight.current = false; }
  }

  async function commitImport() {
    if (!preview) return;
    const reviewedEntries = Object.values(loadedEntries).filter(
      (entry) => entry.disposition === "accepted" && !entry.bank_payment_id,
    );
    const invalid = reviewedEntries.find(
      (entry) =>
        !unrelated[entry.fingerprint] &&
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
    const submission = buildStatementReviewSubmission({
      entries: reviewedEntries,
      unrelated,
      allocationsFor: reviewAllocations,
    });
    if (!submission.ok) {
      setError(submission.error);
      return;
    }
    // Tohle zapisuje peníze na faktury a je to nevratné jinak než uvolněním
    // po jedné. Mazání faktury přitom potvrzovací dialog má -- ta
    // nekonzistence je horší než absence: uživatel si zvykne, že nebezpečné
    // akce se ptají, a tady se nezeptá nic.
    if (!(await confirmAction({
      title: "Zaúčtovat platby k fakturám?",
      description: commitOutcome(reviewedEntries, submission.unrelated_entry_ids.length),
      confirmLabel: "Zaúčtovat",
      confirmVariant: "primary",
    }))) return;
    setWorking(true);
    setBookingStage(0);
    setError("");
    setDone("");
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
      setBookingStage(1);
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
            acknowledge_account_mismatch: accountAck,
          }),
        },
        45_000,
      );
      setBookingStage(2);
      const completed = result.status === "committed" && result.remaining === 0 && !result.errors?.length;
      setDone(
        `${result.status === "committed" ? "Import je dokončený" : "Průběh byl uložen"}: ${result.imported} plateb, ${result.matched} přiřazených položek.${result.unrelated ? ` ${result.unrelated} řádků nesouvisí s fakturami a jako platby se nezapsaly.` : ""}${result.remaining ? ` Zbývá ${result.remaining} položek.` : ""}`,
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
      if (completed) {
        await upload(null);
        setDone("Import proběhl úspěšně.");
        if (queueIndex + 1 >= fileQueue.length) {
          setFileQueue([]);
          setQueueIndex(0);
        }
      } else {
        const updated = await apiFetch<PreviewDetail>(`/api/payments/imports/${preview.import.id}?page=${previewPage}`);
        setPreview(current => current ? { ...current, import: updated.import, entries: updated.entries, totals: updated.totals, total_entries: updated.total_entries } : current);
        setLoadedEntries(Object.fromEntries(updated.entries.map(entry => [entry.fingerprint, entry])));
      }
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
      setBookingStage(null);
      setWorking(false);
    }
  }

  async function download(item: Pick<ArchiveItem, "id">) {
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

  function touch(fingerprint: string) {
    touchedEntries.current.add(fingerprint);
    setConfirmedRows(current => { const next = new Set(current); next.delete(fingerprint); return next; });
  }

  async function changeFile() {
    if (working || mutationInFlight.current) return;
    if (touchedEntries.current.size > 0 && !await confirmAction({
      title: "Opustit rozpracovaný výpis?",
      description: "Nepotvrzené změny v přiřazení faktur se zahodí. Už zaúčtované platby zůstávají.",
      confirmLabel: "Nahrát jiný soubor",
    })) return;
    setFileQueue([]); setQueueIndex(0); void upload(null);
  }

  function canConfirm(entry: PreviewEntry) {
    const info = allocationInfo(entry);
    if (!allocationIsValid(entry, info.values, info.difference, Boolean(partial[entry.fingerprint]), Boolean(unrelated[entry.fingerprint]))) return false;
    const allocations = reviewAllocations(entry);
    return allocations.every(allocation => {
      const invoice = invoiceById.get(allocation.invoice_id);
      return invoice && Number.isFinite(allocation.amount) && minorUnits(allocation.amount) > 0
        && minorUnits(allocation.amount) <= minorUnits(Number(invoice.amount) - Number(invoice.paid_amount));
    });
  }

  async function saveRows(fingerprints: string[]) {
    if (!preview || !canManage || working || mutationInFlight.current || confirmBlockedReason) return;
    const entries = fingerprints.map(key => loadedEntries[key]);
    if (!entries.length || entries.some(entry => !entry || entry.disposition !== "accepted" || entry.bank_payment_id)) return;
    const invalid = entries.find(entry => !canConfirm(entry));
    if (invalid) { setError(`Řádek ${invalid.line_number}: vyberte fakturu a ověřte částky nebo částečnou úhradu.`); return; }
    const submission = buildStatementReviewSubmission({ entries, unrelated, allocationsFor: reviewAllocations });
    if (!submission.ok) { setError(submission.error); return; }
    mutationInFlight.current = true; setWorking(true); setError(""); setDone("");
    try {
      const saved = await apiFetch<{ revision: number }>(`/api/payments/imports/${preview.import.id}`, {
        method: "PATCH", headers: { "content-type": "application/json", "x-idempotency-key": `save-${preview.import.id}-${preview.import.revision}` },
        body: JSON.stringify({ revision: preview.import.revision, reviewed_entry_ids: submission.reviewed_entry_ids, unrelated_entry_ids: submission.unrelated_entry_ids, allocations: submission.allocations }),
      });
      setPreview(current => current ? { ...current, import: { ...current.import, revision: saved.revision } } : current);
      setConfirmedRows(current => new Set([...current, ...fingerprints]));
      // Keep local decisions pinned until the next complete detail fetch.
      setDone(`Přiřazení uloženo (${entries.length}). Platby se zaúčtují až akcí „Zaúčtovat výpis“.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Přiřazení se nepodařilo uložit.");
    } finally { mutationInFlight.current = false; setWorking(false); }
  }

  async function clearAssignment(entry: PreviewEntry) {
    const persisted = loadedEntries[entry.fingerprint];
    if (!preview || !persisted || !canManage || working || mutationInFlight.current || confirmBlockedReason || preview.import.status === "committed" || entry.disposition !== "accepted" || entry.bank_payment_id) return;
    mutationInFlight.current = true;
    setWorking(true); setError(""); setDone("");
    try {
      const saved = await apiFetch<{ revision: number }>(`/api/payments/imports/${preview.import.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-idempotency-key": `clear-${preview.import.id}-${preview.import.revision}-${persisted.id}` },
        body: JSON.stringify({ revision: preview.import.revision, reviewed_entry_ids: [persisted.id], unrelated_entry_ids: [], allocations: [] }),
      });
      touch(entry.fingerprint);
      setSelected(current => ({ ...current, [entry.fingerprint]: [] }));
      setPartial(current => ({ ...current, [entry.fingerprint]: false }));
      setAllocationAmounts(current => ({ ...current, [entry.fingerprint]: {} }));
      setPreview(current => current ? { ...current, import: { ...current.import, revision: saved.revision }, entries: current.entries.map(row => row.fingerprint === entry.fingerprint ? { ...row, proposed_invoice_ids: [] } : row) } : current);
      setDone(`Přiřazení u řádku ${entry.line_number} bylo odstraněno. Platba zůstává nespárovaná.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Přiřazení se nepodařilo odstranit.");
    } finally { mutationInFlight.current = false; setWorking(false); }
  }

  async function acknowledgeOverlap(entry: PreviewEntry) {
    const persisted = loadedEntries[entry.fingerprint];
    if (!preview || !persisted || !canManage || working || mutationInFlight.current) return;
    mutationInFlight.current = true;
    try {
      if (!await confirmAction({ title:"Potvrdit kontrolu možné duplicity?", description:"Ověřili jste původní výpis a tato položka představuje další samostatnou platbu?", confirmLabel:"Ano, je to další platba" })) return;
      setWorking(true); setError("");
      const result = await apiFetch<{ revision:number }>("/api/payments/imports/overlap", { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ entry_id:persisted.id, revision:preview.import.revision }) });
      setLoadedEntries(current => ({ ...current, [entry.fingerprint]: { ...persisted, overlap_acknowledged_by: "confirmed" } }));
      setPreview(current => current ? { ...current, import:{ ...current.import, revision:result.revision }, entries:current.entries.map(row => row.fingerprint === entry.fingerprint ? { ...row, overlap_acknowledged_by:"confirmed" } : row) } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Kontrolu se nepodařilo uložit."); }
    finally { mutationInFlight.current = false; setWorking(false); }
  }

  if (bookingStage !== null) {
    const count = `Výpis ${queueIndex + 1} z ${Math.max(1, fileQueue.length)}`;
    return <ImportProcessingView kind="statement" title="Zaúčtováváme platby z výpisu"
      description="Ukládáme potvrzené přiřazení a zapisujeme platby k fakturám."
      phase={bookingStage} count={count} progressLabel="Zaúčtování bankovního výpisu"
      progressText={`${count}. ${["Ukládáme přiřazení plateb.", "Zaúčtováváme platby.", "Aktualizujeme přehled plateb."][bookingStage]}`}
      stagesLabel="Fáze zaúčtování bankovního výpisu"
      stages={[
        { title: "Uložení přiřazení", detail: "Ukládáme vaše potvrzené přiřazení plateb k fakturám…" },
        { title: "Zaúčtování plateb", detail: "Zapisujeme platby a aktualizujeme uhrazené částky faktur…" },
        { title: "Aktualizace přehledu", detail: "Načítáme výsledek zpracování bankovního výpisu…" },
      ]}
      notice="Po dokončení zobrazíme výsledek importu a případné položky, které ještě vyžadují kontrolu."
    />;
  }

  if (uploading) {
    const count = `Výpis ${queueIndex + 1} z ${Math.max(1, fileQueue.length)}`;
    return <ImportProcessingView kind="statement" title="Zpracováváme bankovní výpis"
      description="Načítáme bankovní výpis a porovnáváme platby s fakturami."
      phase={1} count={count} progressLabel="Zpracování bankovního výpisu"
      progressText={`${count}. Probíhá načítání a párování plateb.`}
      stagesLabel="Fáze zpracování bankovního výpisu"
      stages={[
        { title: "Výběr souboru", detail: "Bankovní výpis je vybraný." },
        { title: "Načítání a párování plateb", detail: "Ověřujeme formát výpisu a hledáme odpovídající faktury…" },
        { title: "Kontrola výsledku", detail: "Po zpracování zobrazíme návrhy shod ke kontrole." },
      ]}
      notice="Po zpracování uvidíte návrhy shod i položky, které potřebují vaši kontrolu."
    />;
  }

  if (preview) return <PaymentMatchingWorkspace
    preview={preview} filename={selectedFilename} queueIndex={queueIndex} queueTotal={fileQueue.length}
    working={working} canManage={canManage} error={error} done={done}
    selected={selected} partial={partial} unrelated={unrelated} allocationAmounts={allocationAmounts}
    invoiceById={invoiceById} candidates={candidateInvoices} candidateTotal={candidateTotal}
    candidateLoading={candidateLoading} candidateError={candidateError} onCandidateRetry={() => setCandidateRetry(value => value + 1)}
    invoiceQuery={invoiceQuery} invoicePage={invoicePage} onInvoiceQuery={value => { setCandidateLoading(true); setInvoiceQuery(value); setInvoicePage(1); }} onInvoicePage={value => { setCandidateLoading(true); setInvoicePage(value); }}
    loadedEntries={loadedEntries} ownTransfers={ownTransfers} matchReasons={matchReasons} confirmedRows={confirmedRows}
    entryFilter={entryFilter} onEntryFilter={value => { setEntryFilter(value); setPreviewPage(1); }}
    page={previewPage} total={filteredEntriesTotal} onPage={setPreviewPage}
    accountAck={accountAck} onAccountAck={setAccountAck} blockedReason={confirmBlockedReason}
    onChangeFile={() => void changeFile()} onNextFile={continueQueue}
    onCommit={() => void commit()} onSaveRows={keys => void saveRows(keys)}
    onDownload={() => void download({ id: preview.import.id })}
    onRelease={entry => { const persisted = loadedEntries[entry.fingerprint]; if (persisted) void releaseEntry(persisted); }}
    onAcknowledgeOverlap={entry => void acknowledgeOverlap(entry)}
    onClearAssignment={entry => void clearAssignment(entry)}
    allocationInfo={allocationInfo} canConfirm={canConfirm}
    onSelected={(key, ids) => { touch(key); setSelected(current => ({ ...current, [key]: ids })); }}
    onPartial={(key, value) => { touch(key); setPartial(current => ({ ...current, [key]: value })); }}
    onAllocation={(key, invoiceId, value) => { touch(key); setAllocationAmounts(current => ({ ...current, [key]: { ...current[key], [invoiceId]: value } })); }}
    onUnrelated={(key, value) => {
      touch(key); setUnrelated(current => ({ ...current, [key]: value }));
      if (value) { setSelected(current => ({ ...current, [key]: [] })); setPartial(current => ({ ...current, [key]: false })); setAllocationAmounts(current => ({ ...current, [key]: {} })); }
    }}
  />;

  return (
    <>
      <section className="page-panel import-panel payment-import-panel gpc-panel" aria-labelledby="gpc-import-title">
          <div className="gpc-intro-grid">
            <div className="gpc-upload-column">
              <div className="gpc-title-row">
                <div><span className="gpc-eyebrow">ZAČNĚTE VÝPISEM</span><h2 id="gpc-import-title">Nahrát bankovní výpis</h2></div>
              </div>
              <p className="gpc-lead">Příchozí platby z výpisu porovnáme s vašimi otevřenými fakturami a připravíme je ke kontrole.</p>
              <label className={`gpc-dropzone ${working ? "is-working" : ""}`}>
                <input
                  type="file"
                  aria-label={camtEnabled ? "Vybrat bankovní výpis ve formátu GPC, CSV nebo CAMT XML" : "Vybrat bankovní výpis ve formátu GPC nebo CSV"}
                  aria-describedby="gpc-upload-formats gpc-upload-limits"
                  aria-errormessage={error ? "gpc-upload-error" : undefined}
                  aria-invalid={Boolean(error) || undefined}
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
                <span className="gpc-dropzone-icon"><Icon name="document" /></span>
                <strong>{working ? "Analyzuji výpis…" : selectedFilename || "Vyberte soubor s výpisem"}</strong>
                {selectedFilename && fileQueue[queueIndex] && <small className="gpc-selected-size">{new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(fileQueue[queueIndex].size / 1024)} kB</small>}
                <small id="gpc-upload-formats">{canManage ? `Podporujeme výpisy ve formátech GPC a CSV${camtEnabled ? " a CAMT XML" : ""}.` : "Import vyžaduje roli účetní nebo administrátor"}</small>
                <span className="gpc-select-file" aria-hidden="true"><Icon name="upload"/><span className="gpc-desktop-button-label">Vybrat bankovní výpis</span><span className="gpc-mobile-button-label">Vybrat soubor</span></span>
                <span className="gpc-file-formats"><span>GPC</span><span>CSV</span>{camtEnabled && <span>XML</span>}</span>
                <small id="gpc-upload-limits" className="gpc-upload-limits">Můžete vybrat jeden i více souborů najednou.<br/>Nejvýše 5 MB na soubor.</small>
                {fileQueue.length > 1 && <small className="gpc-queue-progress">Výpis {Math.min(queueIndex + 1, fileQueue.length)} z {fileQueue.length}</small>}
              </label>
              <div className="gpc-upload-note"><Icon name="check" /><span>Po nahrání uvidíte návrhy shod i položky, které potřebují vaši kontrolu.</span></div>
            </div>
            <BankMatchingProcessInfo/>
          </div>
        {error && <p id="gpc-upload-error" className="form-error" role="alert">{error}</p>}
        {done && <MatchingNotice className="form-success" message={done} />}
        {done && queueIndex + 1 < fileQueue.length && (
          <button type="button" className="btn primary gpc-queue-next" onClick={continueQueue}>
            Pokračovat dalším výpisem ({queueIndex + 2} z {fileQueue.length})
          </button>
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
