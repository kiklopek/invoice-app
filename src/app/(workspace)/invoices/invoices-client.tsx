"use client";

import { SummaryMoney, ExactMoney } from "@/components/money-amount";
import { ChevronDown } from "@/components/chevron-down";
import { CloseIcon } from "@/components/close-icon";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useRevalidateOnRevisit } from "@/lib/revalidate-on-revisit";
import { AppFrame } from "@/components/layout/app-shell";
import { Icon } from "@/components/icons";
import { MobileInvoiceFilters } from "./mobile-invoice-filters";
import { Modal } from "@/components/modal";
import { OptionalPaymentAssignment } from "@/components/optional-payment-assignment";
import { assignBankPaymentToInvoice } from "@/lib/assignable-bank-payment";
import { todayInTimeZone } from "@/lib/reminders";
import { useInvalidateWorkspaceData } from "@/lib/workspace-cache";
import type { Invoice, InvoiceStatus } from "@/types/invoice";
import type { InvoiceListPageData } from "@/lib/invoice-list-page-data";
import type { InvoiceListQuery } from "@/lib/invoice-list-query";
import { useToast } from "@/components/toast";
import { invoiceTotalsKey } from "@/lib/invoice-totals-key";
import { InvoiceListTable } from "./invoice-list-table";
import { InvoiceListSkeleton } from "./invoice-list-skeleton";
import {
  invoicePageNumbers,
  invoiceSortOptions,
  type InvoiceSortOrder,
} from "./invoice-list-presentation";
import styles from "./invoices.module.css";
import {
  DEFAULT_INVOICE_PAGE_SIZE,
  INVOICE_PAGE_SIZES,
  parseInvoicePageSize,
  saveInvoicePageSize,
} from "@/lib/invoice-page-size";

const labels: Record<InvoiceStatus, string> = {
  pending: "Čeká na úhradu",
  overdue: "Po splatnosti",
  paid: "Zaplaceno",
  cancelled: "Stornováno",
};

export function InvoicesClient({
  initialData,
  initialQuery,
  initialKey,
  initialNow,
  initialTotals,
}: {
  initialData: InvoiceListPageData;
  initialQuery: InvoiceListQuery;
  initialKey: string;
  initialNow?: string;
  initialTotals?: Record<string, number>;
}) {
  const router = useRouter();
  const [sortOrder, setSortOrder] = useState<InvoiceSortOrder>({
    field: "default",
    direction: "asc",
  });
  const [today] = useState(() =>
    todayInTimeZone(initialNow ? new Date(initialNow) : new Date()),
  );
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(
      initialQuery.query ||
      initialQuery.amountMin !== null ||
      initialQuery.amountMax !== null ||
      initialQuery.paymentState ||
      initialQuery.bankMatch,
    ),
  );
  const { showToast } = useToast();
  const invalidateWorkspaceData = useInvalidateWorkspaceData();
  const [invoices, setInvoices] = useState<Invoice[]>(initialData.invoices);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [canManage, setCanManage] = useState(initialData.can_manage);
  const [paymentCandidate, setPaymentCandidate] = useState<Invoice | null>(
    null,
  );
  const [paymentDate, setPaymentDate] = useState(todayInTimeZone());
  const [selectedBankPaymentId, setSelectedBankPaymentId] = useState("");
  const [confirmWithoutBankPayment, setConfirmWithoutBankPayment] =
    useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [query, setQuery] = useState(initialQuery.query);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery.query);
  const [status, setStatus] = useState<"all" | "closed" | InvoiceStatus>(
    initialQuery.status ?? "all",
  );
  const [currency, setCurrency] = useState(initialQuery.currency ?? "all");
  const [from, setFrom] = useState(initialQuery.from ?? "");
  const [to, setTo] = useState(initialQuery.to ?? "");
  const [dueFrom, setDueFrom] = useState(initialQuery.dueFrom ?? "");
  const [dueTo, setDueTo] = useState(initialQuery.dueTo ?? "");
  const [amountMin, setAmountMin] = useState(
    initialQuery.amountMin?.toString() ?? "",
  );
  const [amountMax, setAmountMax] = useState(
    initialQuery.amountMax?.toString() ?? "",
  );
  const [paymentState, setPaymentState] = useState(
    initialQuery.paymentState ?? "all",
  );
  const [bankMatch, setBankMatch] = useState(initialQuery.bankMatch ?? "all");
  const [page, setPage] = useState(initialQuery.page);
  const [pageSize, setPageSize] = useState(
    () =>
      parseInvoicePageSize(initialData.page_size) ?? DEFAULT_INVOICE_PAGE_SIZE,
  );
  const [total, setTotal] = useState(initialData.total);
  const [totalPages, setTotalPages] = useState(initialData.total_pages);
  const [currencies, setCurrencies] = useState<string[]>(
    initialData.currencies,
  );
  const [activeCount, setActiveCount] = useState(initialData.active_count);
  const shouldSyncUrl = useRef(false);

  function requestParams(
    requestedPage = page,
    format?: "xlsx",
    searchQuery = query,
  ) {
    const params = new URLSearchParams({
      paged: "1",
      page: String(requestedPage),
    });
    if (pageSize !== DEFAULT_INVOICE_PAGE_SIZE)
      params.set("page_size", String(pageSize));
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (status !== "all") params.set("status", status);
    if (currency !== "all") params.set("currency", currency);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (dueFrom) params.set("due_from", dueFrom);
    if (dueTo) params.set("due_to", dueTo);
    if (amountMin) params.set("amount_min", amountMin);
    if (amountMax) params.set("amount_max", amountMax);
    if (paymentState !== "all") params.set("payment", paymentState);
    if (bankMatch !== "all") params.set("bank_match", bankMatch);
    if (format) params.set("format", format);
    return params;
  }

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedQuery(query),
      query ? 250 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [query]);

  const listKey = `/api/invoices?${requestParams(page, undefined, debouncedQuery).toString()}`;
  useEffect(() => {
    // Only user-initiated filter/page changes belong in the URL. A mount-time
    // replacement (including React Strict Mode's second effect pass) can race
    // and cancel an immediate navigation to another workspace page.
    if (!shouldSyncUrl.current) return;
    shouldSyncUrl.current = false;
    const nextUrl = `/invoices?${listKey.slice(listKey.indexOf("?") + 1)}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    // This is presentation state already fetched by SWR. Native replaceState is
    // synchronous and integrated with the App Router, so a pending RSC
    // navigation cannot race a later click to another workspace page.
    if (window.location.pathname === "/invoices" && currentUrl !== nextUrl)
      window.history.replaceState(null, "", nextUrl);
  }, [listKey]);
  // Sdílená cache přežívá navigaci a ignoruje čerstvý fallbackData ze
  // serveru, takže při NÁVRATU na seznam se musí znovu načíst. Při první
  // návštěvě v cache nic není a initialData ze serveru je čerstvé -- druhý
  // dotaz by byl zbytečný. Server initialData drží první vykreslení bez
  // načítacího záblesku; změna filtru načítá novým klíčem jako dřív.
  const revalidateOnRevisit = useRevalidateOnRevisit(listKey);
  const {
    data: loadedData,
    error: loadError,
    isLoading,
    mutate,
  } = useSWR<InvoiceListPageData>(listKey, {
    fallbackData: listKey === initialKey ? initialData : undefined,
    revalidateOnMount: listKey !== initialKey || revalidateOnRevisit,
    keepPreviousData: false,
  });
  const totalsKey = invoiceTotalsKey(listKey);
  const initialTotalsKey = invoiceTotalsKey(initialKey);
  const totalsRevisit = useRevalidateOnRevisit(totalsKey);
  const {
    data: totals,
    error: totalsError,
    mutate: retryTotals,
  } = useSWR<Record<string, number>>(totalsKey, {
    fallbackData: totalsKey === initialTotalsKey ? initialTotals : undefined,
    revalidateOnMount:
      !initialTotals || totalsKey !== initialTotalsKey || totalsRevisit,
    keepPreviousData: false,
  });
  const loading = isLoading && !loadedData;

  useEffect(() => {
    if (!(loadError instanceof Error)) return;
    // Driv se chyba nacitani zkopirovala do stavu `error`, ktery schoval
    // celou tabulku -- a nikdy se nemazala, takze vterinovy vypadek site
    // znamenal prazdnou stranku az do reloadu. Ted je to oznameni vedle
    // obsahu; uz nactena data zustavaji na obrazovce.
    showToast({ variant: "error", message: loadError.message });
  }, [loadError, showToast]);

  useEffect(() => {
    if (!loadedData) return;
    setInvoices(loadedData.invoices ?? []);
    setTotal(Number(loadedData.total) || 0);
    setTotalPages(Number(loadedData.total_pages) || 1);
    setCurrencies(loadedData.currencies ?? []);
    setActiveCount(Number(loadedData.active_count) || 0);
    setCanManage(Boolean(loadedData.can_manage));
  }, [loadedData]);

  // Prázdná data a prázdný výsledek filtru jsou dva různé stavy; bez tohohle
  // rozlišení hláška nové organizaci tvrdila, že nic neodpovídá filtru,
  // který vůbec nebyl nastavený.
  const hasActiveFilter =
    Boolean(query.trim()) ||
    status !== "all" ||
    currency !== "all" ||
    Boolean(from) ||
    Boolean(to) ||
    Boolean(dueFrom) ||
    Boolean(dueTo) ||
    Boolean(amountMin) ||
    Boolean(amountMax) ||
    paymentState !== "all" ||
    bankMatch !== "all";

  function clearFilters() {
    changeFilter(() => {
      setQuery("");
      setStatus("all");
      setCurrency("all");
      setFrom("");
      setTo("");
      setDueFrom("");
      setDueTo("");
      setAmountMin("");
      setAmountMax("");
      setPaymentState("all");
      setBankMatch("all");
    });
  }

  function changeFilter(change: () => void) {
    shouldSyncUrl.current = true;
    setPage(1);
    change();
  }
  function changePage(nextPage: number) {
    shouldSyncUrl.current = true;
    setPage(nextPage);
  }
  function prefetchInvoice(id: string) {
    router.prefetch(`/invoices/${id}`);
  }
  async function exportExcel(selectedIds?: string[]) {
    setExporting(true);
    try {
      // Selection belongs to the displayed page and its applied filters.
      const params = selectedIds?.length
        ? new URLSearchParams(listKey.slice(listKey.indexOf("?") + 1))
        : requestParams(1, "xlsx");
      params.set("format", "xlsx");
      if (selectedIds?.length) params.set("selected_ids", selectedIds.join(","));
      const response = await fetch(`/api/invoices?${params.toString()}`);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Export se nepodařilo připravit.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = selectedIds?.length ? "vybrane-faktury.xlsx" : `faktury-${from || "zacatek"}-${to || "dnes"}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      showToast({
        variant: "error",
        message:
          cause instanceof Error
            ? cause.message
            : "Export se nepodařilo připravit.",
      });
    } finally {
      setExporting(false);
    }
  }

  async function confirmPayment() {
    if (!paymentCandidate) return;
    setConfirmingPayment(true);
    setNotice("");
    try {
      let data: { invoice?: Invoice; error?: string } = {};
      if (selectedBankPaymentId) {
        const assignment = await assignBankPaymentToInvoice(
          selectedBankPaymentId,
          paymentCandidate.id,
        );
        if (assignment.settlement === "partial") {
          setInvoices((current) =>
            current.map((item) =>
              item.id === paymentCandidate.id
                ? {
                    ...item,
                    paid_amount: assignment.paid_amount ?? item.paid_amount,
                    status: assignment.invoice_status ?? item.status,
                  }
                : item,
            ),
          );
          setNotice(
            `Bankovní platba byla přiřazena k faktuře ${paymentCandidate.invoice_number} jako částečná úhrada. Faktura zůstává otevřená.`,
          );
          setPaymentCandidate(null);
          void invalidateWorkspaceData();
          return;
        }
        if (assignment.invoice_status !== "paid")
          throw new Error(
            "Platba byla přiřazena, ale nepokryla celý zbývající zůstatek faktury.",
          );
      } else {
        if (!confirmWithoutBankPayment) return;
        const response = await fetch(`/api/invoices/${paymentCandidate.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "paid", paid_on: paymentDate }),
        });
        data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Úhradu se nepodařilo potvrdit.");
      }

      setInvoices((current) =>
        status === "pending" || status === "overdue"
          ? current.filter((item) => item.id !== paymentCandidate.id)
          : selectedBankPaymentId
            ? current
            : current.map((item) =>
                item.id === paymentCandidate.id && data.invoice
                  ? data.invoice
                  : item,
              ),
      );
      setActiveCount((current) => Math.max(0, current - 1));
      if (status === "pending" || status === "overdue") {
        const nextTotal = Math.max(0, total - 1);
        setTotal(nextTotal);
        setTotalPages(Math.max(1, Math.ceil(nextTotal / pageSize)));
      }
      setNotice(
        `Úhrada faktury ${paymentCandidate.invoice_number} byla potvrzena.`,
      );
      setPaymentCandidate(null);
      // Úhrada mění čísla i na Přehledu, ne jen v seznamu.
      void invalidateWorkspaceData();
    } catch (cause) {
      showToast({
        variant: "error",
        message:
          cause instanceof Error
            ? cause.message
            : "Úhradu se nepodařilo potvrdit.",
      });
    } finally {
      setConfirmingPayment(false);
    }
  }

  return (
    <AppFrame
      invoiceCount={loading ? undefined : activeCount}
      className={`content section-page ${styles.page}`}
    >
      <header className={styles.pageHeader}>
        <div>
          <p>FAKTURY</p>
          <h1>Všechny faktury</h1>
          <span className={styles.subtitle}>
            Přehled všech vydaných faktur, jejich stav a platby.
          </span>
        </div>
        <section
          className={styles.summary}
          data-invoice-summary
          aria-label="Součet faktur podle filtrů"
          aria-live="polite"
          aria-busy={!totals && !totalsError}
        >
          <Icon name="invoice" className={styles.summaryIcon} />
          <span className={styles.mobileMoneyIcon}><Icon name="banknote" /></span>
          <div className={styles.summaryAmounts}>
            <span className={styles.mobileSummaryLabel}>Součet ve výběru</span>
            {totalsError ? (
              <div className={styles.summaryError}>
                <span>Součet se nepodařilo načíst.</span>
                <button type="button" onClick={() => void retryTotals()}>
                  Zkusit znovu
                </button>
              </div>
            ) : !totals ? (
              <span className={styles.summaryLoading}>Počítám…</span>
            ) : Object.keys(totals).length ? (
              Object.entries(totals).map(([code, value]) => (
                <div key={code}><SummaryMoney value={value} currency={code} /></div>
              ))
            ) : (
              <SummaryMoney value={0} currency={currency === "all" ? "CZK" : currency} />
            )}
          </div>
        </section>
      </header>
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
      <section
        className={styles.panel}
        aria-label="Přehled faktur"
        aria-busy={loading}
      >
        <MobileInvoiceFilters
          label={hasActiveFilter ? "Filtry · aktivní" : "Filtry"}
          className={styles.disclosure}
          query={query} onQuery={value=>changeFilter(()=>setQuery(value))}
          status={status} onStatus={value=>changeFilter(()=>setStatus(value))}
          active={hasActiveFilter} onReset={clearFilters}
        >
          <section
            className={styles.filters}
            data-invoice-filters
            aria-label="Filtry faktur"
          >
            <div className={styles.filterGrid}>
              <label>
                <span>Stav</span>
                <select
                  value={status}
                  onChange={(e) =>
                    changeFilter(() =>
                      setStatus(e.target.value as typeof status),
                    )
                  }
                >
                  <option value="all">Všechny stavy</option>
                  {Object.entries(labels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                  <option value="closed">Uzavřené</option>
                </select>
              </label>
              <label>
                <span>Seřadit podle</span>
                <select
                  value={`${sortOrder.field}:${sortOrder.direction}`}
                  aria-describedby="invoice-sort-scope"
                  onChange={(event) => {
                    const option = invoiceSortOptions.find(
                      (option) =>
                        `${option.field}:${option.direction}` ===
                        event.target.value,
                    );
                    if (option)
                      setSortOrder({
                        field: option.field,
                        direction: option.direction,
                      });
                  }}
                >
                  {invoiceSortOptions.map((option) => (
                    <option
                      key={`${option.field}:${option.direction}`}
                      value={`${option.field}:${option.direction}`}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <span id="invoice-sort-scope" className={styles.srOnly}>
                Řazení se vztahuje na aktuální stránku faktur.
              </span>
              <div
                className={styles.range}
                role="group"
                aria-label="Datum vystavení"
              >
                <span>Datum vystavení</span>
                <div className={styles.dateRange}>
                  <div className={styles.dateInput}>
                    <input
                      type="date"
                      aria-label="Vystaveno od"
                      value={from}
                      max={to || undefined}
                      onChange={(e) =>
                        changeFilter(() => setFrom(e.target.value))
                      }
                    />
                    <Icon name="calendar" />
                  </div>
                  <span aria-hidden="true">–</span>
                  <div className={styles.dateInput}>
                    <input
                      type="date"
                      aria-label="Vystaveno do"
                      value={to}
                      min={from || undefined}
                      onChange={(e) =>
                        changeFilter(() => setTo(e.target.value))
                      }
                    />
                    <Icon name="calendar" />
                  </div>
                </div>
              </div>
              <div
                className={styles.range}
                role="group"
                aria-label="Datum splatnosti"
              >
                <span>Datum splatnosti</span>
                <div className={styles.dateRange}>
                  <div className={styles.dateInput}>
                    <input
                      type="date"
                      aria-label="Splatnost od"
                      value={dueFrom}
                      max={dueTo || undefined}
                      onChange={(e) =>
                        changeFilter(() => setDueFrom(e.target.value))
                      }
                    />
                    <Icon name="calendar" />
                  </div>
                  <span aria-hidden="true">–</span>
                  <div className={styles.dateInput}>
                    <input
                      type="date"
                      aria-label="Splatnost do"
                      value={dueTo}
                      min={dueFrom || undefined}
                      onChange={(e) =>
                        changeFilter(() => setDueTo(e.target.value))
                      }
                    />
                    <Icon name="calendar" />
                  </div>
                </div>
              </div>
              <div className={styles.filterActions}>
                <button
                  type="button"
                  aria-expanded={advancedOpen}
                  aria-controls="invoice-advanced-filters"
                  onClick={() => setAdvancedOpen((value) => !value)}
                >
                  Další filtry{" "}
                  <ChevronDown />
                </button>
                <details className={styles.pageMenu}>
                  <summary aria-label="Další akce faktur">
                    <Icon name="more" />
                  </summary>
                  <div data-popup>
                    {canManage ? (
                      <Link href="/invoices/payments">Bankovní platby</Link>
                    ) : null}
                    <Link href="/invoices/archive">Archiv faktur</Link>
                    <button
                      type="button"
                      onClick={() => void exportExcel()}
                      disabled={!total || exporting}
                    >
                      {exporting ? "Připravuji…" : "Export do Excelu"}
                    </button>
                  </div>
                </details>
              </div>
            </div>
            <div id="invoice-advanced-filters" hidden={!advancedOpen}>
              <div className={styles.advanced}>
                <label className={styles.localSearch}>
                  <span>Hledat v tabulce</span>
                  <input
                    type="search"
                    value={query}
                    maxLength={100}
                    onChange={(e) =>
                      changeFilter(() => setQuery(e.target.value))
                    }
                    placeholder="Číslo faktury, odběratel, IČO, DIČ, e-mail, VS nebo poznámka"
                    aria-describedby="invoice-search-hint"
                  />
                  <small id="invoice-search-hint">
                    Bez diakritiky, i podle více slov v libovolném pořadí.
                  </small>
                </label>
                <label>
                  <span>Měna</span>
                  <select
                    value={currency}
                    onChange={(e) =>
                      changeFilter(() => setCurrency(e.target.value))
                    }
                  >
                    <option value="all">Všechny měny</option>
                    {currencies.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Částka od</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountMin}
                    onChange={(e) =>
                      changeFilter(() => setAmountMin(e.target.value))
                    }
                  />
                </label>
                <label>
                  <span>Částka do</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountMax}
                    onChange={(e) =>
                      changeFilter(() => setAmountMax(e.target.value))
                    }
                  />
                </label>
                <label>
                  <span>Stav úhrady</span>
                  <select
                    value={paymentState}
                    onChange={(e) =>
                      changeFilter(() =>
                        setPaymentState(e.target.value as typeof paymentState),
                      )
                    }
                  >
                    <option value="all">Všechny</option>
                    <option value="unpaid">Bez úhrady</option>
                    <option value="partial">Částečně uhrazené</option>
                    <option value="paid">Plně uhrazené</option>
                  </select>
                </label>
                <label>
                  <span>Bankovní párování</span>
                  <select
                    value={bankMatch}
                    onChange={(e) =>
                      changeFilter(() =>
                        setBankMatch(e.target.value as typeof bankMatch),
                      )
                    }
                  >
                    <option value="all">Všechny</option>
                    <option value="matched">Má bankovní vazbu</option>
                    <option value="unmatched">Bez bankovní vazby</option>
                  </select>
                </label>
              </div>
            </div>
            {hasActiveFilter ? (
              <div className={styles.activeFilters} aria-label="Aktivní filtry">
                {query.trim() ? <span>Hledat: {query}</span> : null}
                {status !== "all" ? (
                  <span>
                    {status === "closed" ? "Uzavřené" : labels[status]}
                  </span>
                ) : null}
                {currency !== "all" ? <span>{currency}</span> : null}
                {from || to ? (
                  <span>
                    Vystavení: {from || "…"} – {to || "…"}
                  </span>
                ) : null}
                {dueFrom || dueTo ? (
                  <span>
                    Splatnost: {dueFrom || "…"} – {dueTo || "…"}
                  </span>
                ) : null}
                {amountMin || amountMax ? (
                  <span>
                    Částka: {amountMin || "0"} – {amountMax || "…"}
                  </span>
                ) : null}
                {paymentState !== "all" ? (
                  <span>
                    Úhrada:{" "}
                    {paymentState === "partial"
                      ? "částečná"
                      : paymentState === "paid"
                        ? "plná"
                        : "bez úhrady"}
                  </span>
                ) : null}
                {bankMatch !== "all" ? (
                  <span>
                    {bankMatch === "matched"
                      ? "S bankovní vazbou"
                      : "Bez bankovní vazby"}
                  </span>
                ) : null}
                <button type="button" onClick={clearFilters}>
                  Vymazat filtry
                </button>
              </div>
            ) : null}
          </section>
        </MobileInvoiceFilters>
        {loadError ? (
          <div role="alert" className={styles.error}>
            <span>
              Faktury se nepodařilo načíst. Již načtené údaje mohou být
              neaktuální.
            </span>
            <button type="button" onClick={() => void mutate()}>
              Zkusit znovu
            </button>
          </div>
        ) : null}
        {loading ? (
          <InvoiceListSkeleton />
        ) : !invoices.length && loadError ? null : !invoices.length ? (
          <div className={styles.empty}>
            {hasActiveFilter ? (
              <>
                <strong>Žádné faktury neodpovídají zadaným filtrům.</strong>
                <p>Zkuste rozšířit období nebo zrušit některý filtr.</p>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={clearFilters}
                >
                  Vymazat filtry
                </button>
              </>
            ) : (
              <>
                <strong>Zatím nemáte žádné faktury.</strong>
                <p>Přidejte již vystavenou fakturu do evidence Splatna.</p>
                {canManage ? (
                  <div className={styles.emptyActions}>
                    <Link href="/invoices/import" className="btn primary">
                      Importovat fakturu
                    </Link>
                    <Link href="/invoices/new" className="btn secondary">
                      Přidat ručně
                    </Link>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <InvoiceListTable
            key={listKey}
            sortOrder={sortOrder}
            onSortChange={setSortOrder}
            invoices={invoices}
            onExportSelected={ids => void exportExcel(ids)}
            exporting={exporting}
            canManage={canManage}
            today={today}
            onPrefetch={prefetchInvoice}
            onOpen={(id) => router.push(`/invoices/${id}`)}
            onConfirm={(invoice) => {
              setPaymentDate(todayInTimeZone());
              setSelectedBankPaymentId("");
              setConfirmWithoutBankPayment(false);
              setPaymentCandidate(invoice);
            }}
          />
        )}
        <nav
          className={styles.pagination}
          data-invoice-pagination
          aria-label="Stránkování faktur"
        >
          <span aria-live="polite">
            Zobrazuji {total ? (page - 1) * pageSize + 1 : 0}–
            {total ? (page - 1) * pageSize + invoices.length : 0} z {total}{" "}
            faktur
          </span>
          <div className={styles.paginationControls}>
            <select
              className={styles.pageSize}
              aria-label="Faktur na stránku"
              value={pageSize}
              disabled={loading}
              onChange={(event) => {
                const size = parseInvoicePageSize(event.target.value);
                if (!size || size === pageSize) return;
                shouldSyncUrl.current = true;
                setPage(1);
                setPageSize(size);
                saveInvoicePageSize(size);
              }}
            >
              {INVOICE_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} na stránku
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Předchozí stránka"
              disabled={loading || page <= 1}
              onClick={() => changePage(page - 1)}
            >
              <Icon name="arrow-left" />
            </button>
            {invoicePageNumbers(page, totalPages).map(
              (number, index, numbers) => (
                <span key={number} style={{ display: "contents" }}>
                  {index > 0 && number > numbers[index - 1] + 1 ? (
                    <span aria-hidden="true">…</span>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Stránka ${number}`}
                    aria-current={page === number ? "page" : undefined}
                    disabled={loading}
                    onClick={() => changePage(number)}
                  >
                    {number}
                  </button>
                </span>
              ),
            )}
            <button
              type="button"
              aria-label="Další stránka"
              disabled={loading || page >= totalPages}
              onClick={() => changePage(page + 1)}
            >
              <Icon name="arrow-right" />
            </button>
          </div>
        </nav>
      </section>
      <Modal
        open={Boolean(paymentCandidate)}
        onClose={() => setPaymentCandidate(null)}
        closeDisabled={confirmingPayment}
        labelledBy="list-payment-confirm-title"
        className="payment-confirm-modal"
      >
        {paymentCandidate && (
          <>
            <header>
              <div>
                <small>POTVRZENÍ ÚHRADY</small>
                <h2 id="list-payment-confirm-title">
                  Opravdu potvrdit úhradu faktury{" "}
                  {paymentCandidate.invoice_number}?
                </h2>
                <p>
                  {selectedBankPaymentId
                    ? "Bankovní platba se přiřadí k faktuře. Upomínky se zastaví po úplné úhradě."
                    : "Faktura bude označena jako zaplacená zvoleným dnem a automatické upomínky se zastaví."}
                </p>
              </div>
              <button
                type="button"
                aria-label="Zavřít potvrzení úhrady"
                disabled={confirmingPayment}
                onClick={() => setPaymentCandidate(null)}
              >
                <CloseIcon />
              </button>
            </header>
            <div className="payment-confirm-content">
              <div className="quick-payment-summary">
                <span>Odběratel</span>
                <strong>{paymentCandidate.counterparty_name}</strong>
                <span>Částka</span>
                <strong>
                  <ExactMoney value={Number(paymentCandidate.amount)} currency={paymentCandidate.currency} />
                </strong>
              </div>
              <OptionalPaymentAssignment
                invoiceId={paymentCandidate.id}
                enabled={Boolean(paymentCandidate)}
                selectedPaymentId={selectedBankPaymentId}
                confirmWithoutPayment={confirmWithoutBankPayment}
                onSelectPayment={setSelectedBankPaymentId}
                onConfirmWithoutPayment={setConfirmWithoutBankPayment}
              />
              {!selectedBankPaymentId && (
                <label className="quick-payment-date">
                  <span>Datum úhrady</span>
                  <input
                    type="date"
                    value={paymentDate}
                    max={todayInTimeZone()}
                    onChange={(event) => setPaymentDate(event.target.value)}
                  />
                  <small>Zadejte skutečný den, kdy byla částka připsána.</small>
                </label>
              )}
            </div>
            <footer className="payment-confirm-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={confirmingPayment || !paymentDate}
                onClick={() => setPaymentCandidate(null)}
              >
                Zrušit
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={
                  confirmingPayment ||
                  (!selectedBankPaymentId &&
                    (!paymentDate || !confirmWithoutBankPayment))
                }
                onClick={confirmPayment}
              >
                {confirmingPayment
                  ? "Ukládám…"
                  : selectedBankPaymentId
                    ? "Přiřadit a potvrdit"
                    : "Potvrdit bez platby"}
              </button>
            </footer>
          </>
        )}
      </Modal>
    </AppFrame>
  );
}
