"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import { Icon } from "@/components/icons";
import { ChevronDown } from "@/components/chevron-down";
import { CloseIcon } from "@/components/close-icon";
import { reportPresetRange } from "@/lib/report-presentation";
import type { ReportDateBasis } from "@/lib/report-query";
import type { InvoiceStatus } from "@/types/invoice";
import styles from "./reports.module.css";

export type ReportFilters = {
  from: string; to: string; currency: string; status: "all" | InvoiceStatus;
  customer: string; dateBasis: ReportDateBasis;
};
const periods = [["month", "Tento měsíc"], ["quarter", "Toto čtvrtletí"], ["year", "Tento rok"]] as const;
const bases: Record<ReportDateBasis, string> = { issue_date: "Datum vystavení", due_date: "Datum splatnosti", paid_at: "Datum úplné úhrady" };
const statuses: Record<InvoiceStatus, string> = { pending: "Čeká", overdue: "Po splatnosti", paid: "Zaplaceno", cancelled: "Storno" };
type PeriodKey = typeof periods[number][0];
export function selectedReportPeriod(filters: Pick<ReportFilters, "from" | "to">, today: string, preferred?: PeriodKey | null) {
  const ordered = preferred ? [...periods].sort(([a], [b]) => Number(b === preferred) - Number(a === preferred)) : periods;
  return ordered.find(([key]) => {
    const range = reportPresetRange(key, today);
    return range.from === filters.from && range.to === filters.to;
  });
}
export function activeReportFilterCount(value: ReportFilters, payments: boolean) {
  return payments ? 0 : Number(value.currency !== "CZK") + Number(value.status !== "all")
    + Number(value.customer !== "all") + Number(value.dateBasis !== "issue_date");
}

/** Native modal with the same keyboard/focus behavior as the rest of Splatno. */
export function ReportSheet({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode;
}) {
  const titleId = useId();
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const update = () => {
      const viewport = window.visualViewport;
      const dialog = header.current?.closest("dialog");
      dialog?.style.setProperty("--report-sheet-height", `${Math.max(0, (viewport?.height ?? innerHeight) - 16)}px`);
      dialog?.style.setProperty("--report-sheet-bottom", `${Math.max(0, innerHeight - (viewport?.offsetTop ?? 0) - (viewport?.height ?? innerHeight))}px`);
    };
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      document.body.style.overflow = previous;
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [open]);
  return <Modal open={open} onClose={onClose} labelledBy={titleId} className={styles.mobileSheet}>
    <header ref={header}><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label={`Zavřít: ${title}`}><CloseIcon /></button></header>
    <div className={styles.sheetBody}>{children}</div>
    {footer && <footer>{footer}</footer>}
  </Modal>;
}

export function MobileReportControls({ value, defaults, today, payments, customers, currencies, onApply }: {
  value: ReportFilters; defaults: ReportFilters; today: string; payments: boolean;
  customers: string[]; currencies: string[]; onApply: (filters: ReportFilters) => void;
}) {
  const [sheet, setSheet] = useState<"period" | "filters" | null>(null);
  const [draft, setDraft] = useState(value);
  const [custom, setCustom] = useState(false);
  const [preferred, setPreferred] = useState<PeriodKey | null>(null);
  const [draftPeriod, setDraftPeriod] = useState<PeriodKey | null>(null);
  const formId = useId();
  const period = selectedReportPeriod(value, today, preferred);
  const selected = selectedReportPeriod(draft, today, draftPeriod);
  const count = activeReportFilterCount(value, payments);
  const valid = Boolean(draft.from && draft.to && draft.from <= draft.to);
  function open(kind: "period" | "filters") {
    setDraft({ ...value }); setDraftPeriod(period?.[0] ?? null); setCustom(!period); setSheet(kind);
  }
  function choose(key: typeof periods[number][0]) {
    setDraft(current => ({ ...current, ...reportPresetRange(key, today) })); setDraftPeriod(key); setCustom(false);
  }
  function apply() {
    if (!valid) return;
    // Period changes and bank reports never overwrite retained invoice filters.
    onApply(sheet === "period" || payments ? { ...value, from: draft.from, to: draft.to } : draft);
    setPreferred(custom ? null : draftPeriod);
    setSheet(null);
  }
  return <>
    <div className={styles.mobileControls} aria-label="Období a filtry reportu">
      <button type="button" className={styles.periodButton} aria-label={`Vybrat období: ${period?.[1] ?? "Vlastní období"}`} aria-haspopup="dialog" onClick={event => { event.currentTarget.focus({ preventScroll: true }); open("period"); }}>
        <Icon name="calendar" /><span>{period?.[1] ?? "Vlastní období"}</span><ChevronDown />
      </button>
      <button type="button" className={styles.filterButton} aria-label="Otevřít filtry" aria-haspopup="dialog" data-active={count > 0 || undefined} onClick={event => { event.currentTarget.focus({ preventScroll: true }); open("filters"); }}>
        <Icon name="filter" />{count > 0 && <span aria-label={`${count} aktivní filtry`}>{count}</span>}
      </button>
    </div>
    <ReportSheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet === "period" ? "Vybrat období" : "Filtry"} footer={<>
      {sheet === "filters" && <button type="button" className={styles.sheetSecondary} onClick={() => { setDraft({ ...defaults }); setDraftPeriod(null); setCustom(!selectedReportPeriod(defaults, today)); }}>Resetovat</button>}
      <button type="submit" form={formId} className={styles.sheetPrimary} disabled={!valid}>{sheet === "period" ? "Použít" : "Použít filtry"}</button>
    </>}>
      <form id={formId} onSubmit={event => { event.preventDefault(); apply(); }} className={styles.sheetForm}>
        {sheet === "period" && <div className={styles.periodTabs} role="group" aria-label="Způsob výběru období">
          <button type="button" aria-pressed={!custom} onClick={() => setCustom(false)}>Předvolby</button>
          <button type="button" aria-pressed={custom} onClick={() => setCustom(true)}>Vlastní období</button>
        </div>}
        <fieldset className={sheet === "period" && !custom ? styles.periodOptions : styles.sheetPresets}>
          <legend>Období</legend>
          {periods.map(([key, label]) => <button key={key} type="button" aria-pressed={!custom && selected?.[0] === key} onClick={() => choose(key)}>{label}{!custom && selected?.[0] === key && <Icon name="check" />}</button>)}
          <button type="button" aria-pressed={custom} onClick={() => setCustom(true)}>Vlastní období{custom && <Icon name="check" />}</button>
        </fieldset>
        {custom && <div className={styles.sheetDates}>
          <label>Od<input type="date" required aria-label="Od" value={draft.from} max={draft.to || undefined} onChange={event => setDraft({ ...draft, from: event.target.value })} /></label>
          <label>Do<input type="date" required aria-label="Do" value={draft.to} min={draft.from || undefined} onChange={event => setDraft({ ...draft, to: event.target.value })} /></label>
        </div>}
        {!valid && <p role="alert" className={styles.sheetError}>Vyberte platné datum od a do. Začátek nesmí být po konci období.</p>}
        {sheet === "filters" && !payments && <>
          <label>Období podle<select aria-label="Období podle" value={draft.dateBasis} onChange={event => setDraft({ ...draft, dateBasis: event.target.value as ReportDateBasis })}>{Object.entries(bases).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Měna<select aria-label="Měna" value={draft.currency} onChange={event => setDraft({ ...draft, currency: event.target.value })}>{currencies.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>Stav faktury<select aria-label="Stav faktury" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as ReportFilters["status"] })}><option value="all">Všechny stavy</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Odběratel<select aria-label="Odběratel" value={draft.customer} onChange={event => setDraft({ ...draft, customer: event.target.value })}><option value="all">Všichni odběratelé</option>{customers.map(item => <option key={item}>{item}</option>)}</select></label>
        </>}
        <p className={styles.sheetNote}>{payments ? "Období podle zaúčtování výpisu; nespárované platby podle bankovního zaúčtování. Celá firma, všechny měny. Fakturové filtry se neuplatní." : `${bases[draft.dateBasis]}. Pohledávky představují současné zůstatky vybraných faktur.`}</p>
      </form>
    </ReportSheet>
  </>;
}

export function MobileReportExport({ ready, exporting, error, onExcel, onPrint, period, currency, payments }: {
  ready: boolean; exporting: boolean; error: string; onExcel: () => Promise<void>; onPrint: () => void;
  period: string; currency: string; payments: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("pdf");
  return <>
    <button type="button" className={styles.mobileExport} onClick={event => { event.currentTarget.focus({ preventScroll: true }); setOpen(true); }} aria-haspopup="dialog" aria-label="Exportovat report"><Icon name="download" /><span>Exportovat</span><ChevronDown /></button>
    <ReportSheet open={open} onClose={() => setOpen(false)} title="Exportovat" footer={<button type="button" className={styles.sheetPrimary} disabled={!ready || exporting} onClick={() => {
      if (format === "xlsx") void onExcel();
      else { setOpen(false); requestAnimationFrame(onPrint); }
    }}>{exporting ? "Připravuji…" : "Exportovat"}</button>}>
      <p className={styles.sheetNote}>{period} · {payments ? "výpisy celé firmy, všechny měny" : currency}</p>
      <fieldset className={styles.exportOptions}><legend>Formát exportu</legend>
        <label><input type="radio" name="report-export-format" value="pdf" checked={format === "pdf"} onChange={() => setFormat("pdf")} /><span><strong>Tisk / PDF</strong><small>Všechny kapitoly, včetně výpisů celé firmy. PDF uložíte v nabídce tisku.</small></span></label>
        <label><input type="radio" name="report-export-format" value="xlsx" checked={format === "xlsx"} onChange={() => setFormat("xlsx")} /><span><strong>Excel</strong><small>Faktury, DPH a aging podle fakturových filtrů. Neobsahuje bankovní výpisy.</small></span></label>
      </fieldset>
      {error && <p role="alert" className={styles.sheetError}>{error}</p>}
    </ReportSheet>
  </>;
}
