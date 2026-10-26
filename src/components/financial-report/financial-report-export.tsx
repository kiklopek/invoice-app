"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Modal } from "@/components/modal";
import { Icon } from "@/components/icons";
import { CloseIcon } from "@/components/close-icon";
import {
  DEFAULT_REPORT_OPTIONS,
  REPORT_BASES,
  REPORT_MODES,
  REPORT_SECTIONS,
  REPORT_STATUS,
  type ReportOptions,
  type ReportSection,
} from "@/lib/financial-report";
import type { ReportQuery } from "@/lib/report-query";
import type { InvoiceStatus } from "@/types/invoice";
import styles from "./financial-report-export.module.css";
const DocumentPreview = dynamic(
  () => import("@/components/document-preview").then((m) => m.DocumentPreview),
  { ssr: false, loading: () => <p role="status">Načítám náhled PDF…</p> },
);
type Artifact = {
  file: File;
  url: string;
  pages: number;
  generated: string;
  key: string;
};
export function FinancialReportExport({
  query,
  currencies,
  customers,
  ready,
  exporting,
  onExcel,
}: {
  query: ReportQuery;
  currencies: string[];
  customers: string[];
  ready: boolean;
  exporting: boolean;
  onExcel: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [options, setOptions] = useState<ReportOptions>(DEFAULT_REPORT_OPTIONS),
    [filters, setFilters] = useState(query),
    [artifact, setArtifact] = useState<Artifact | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const formId = useId();
  const lock = useRef(false),
    controller = useRef<AbortController | null>(null),
    objectUrl = useRef<string | null>(null),
    frame = useRef<HTMLIFrameElement>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );
  const currentKey = JSON.stringify({ query: filters, options }),
    fresh = artifact?.key === currentKey;
  function close() {
    controller.current?.abort();
    setOpen(false);
    setBusy(false);
    lock.current = false;
  }
  const generate = useCallback(
    async (requestFilters = filters, requestOptions = options) => {
      if (lock.current) return;
      const requestKey = JSON.stringify({
        query: requestFilters,
        options: requestOptions,
      });
      lock.current = true;
      setBusy(true);
      setError("");
      setNotice("");
      const abort = new AbortController();
      controller.current = abort;
      try {
        const response = await fetch("/api/reports/pdf", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestKey,
          signal: abort.signal,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || "Report se nepodařilo vytvořit.");
        }
        if (!response.headers.get("content-type")?.includes("application/pdf"))
          throw new Error("Server nevrátil PDF dokument.");
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        const file = new File(
          [blob],
          `Splatno-report-${requestFilters.from}-${requestFilters.to}-${requestFilters.currency}.pdf`,
          { type: "application/pdf" },
        );
        const url = URL.createObjectURL(file);
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = url;
        setArtifact({
          file,
          url,
          pages: Number(response.headers.get("x-report-pages")) || 0,
          generated: response.headers.get("x-report-generated-at") ?? "",
          key: requestKey,
        });
      } catch (cause) {
        if (!abort.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Report se nepodařilo vytvořit.",
          );
      } finally {
        if (controller.current === abort) {
          lock.current = false;
          setBusy(false);
        }
      }
    },
    [filters, options],
  );
  const launch = useCallback(() => {
    const nextFilters = { ...query };
    setFilters(nextFilters);
    setOpen(true);
    setError("");
    setNotice("");
    if (artifact?.key !== JSON.stringify({ query: nextFilters, options }))
      void generate(nextFilters, options);
  }, [query, options, artifact?.key, generate]);
  useEffect(() => {
    const handlePrint = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        launch();
      }
    };
    window.addEventListener("keydown", handlePrint);
    return () => window.removeEventListener("keydown", handlePrint);
  }, [launch]);
  function download() {
    if (!artifact || !fresh) return;
    const link = document.createElement("a");
    link.href = artifact.url;
    link.download = artifact.file.name;
    document.body.append(link);
    link.click();
    link.remove();
  }
  function print() {
    if (!artifact || !fresh) return;
    try {
      if (!frame.current?.contentWindow) throw new Error();
      frame.current.contentWindow.focus();
      frame.current.contentWindow.print();
      setNotice(
        "Tisk používá stejné PDF jako náhled a stažení. Pokud prohlížeč tisk neotevřel, otevřete PDF samostatně.",
      );
    } catch {
      setNotice(
        "Prohlížeč nepovolil přímý tisk. Otevřete PDF samostatně a použijte jeho nabídku tisku.",
      );
    }
  }
  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-label="Exportovat report"
        aria-haspopup="dialog"
        disabled={!ready}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          launch();
        }}
      >
        <Icon name="download" />
        <span>Exportovat</span>
      </button>
      <Modal
        open={open}
        onClose={close}
        labelledBy="financial-export-title"
        className={styles.dialog}
      >
        <header className={styles.header}>
          <div>
            <h2 id="financial-export-title">Exportovat finanční report</h2>
            <p>Jeden dokument pro náhled, stažení i tisk.</p>
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label="Zavřít export"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </header>
        <div className={styles.body}>
          <form
            id={formId}
            className={styles.settings}
            onSubmit={(e) => {
              e.preventDefault();
              void generate();
            }}
          >
            <fieldset disabled={busy}>
              <legend>Typ reportu</legend>
              <div className={styles.modes}>
                {Object.entries(REPORT_MODES).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="radio"
                      name="financial-report-mode"
                      value={key}
                      checked={options.mode === key}
                      onChange={() =>
                        setOptions({
                          ...options,
                          mode: key as ReportOptions["mode"],
                        })
                      }
                    />
                    <span>
                      {label}
                      <small>
                        {key === "summary"
                          ? "Hlavní ukazatele bez podrobných registrů"
                          : key === "detailed"
                            ? "Přehledy a vybrané detaily"
                            : key === "complete"
                              ? "Všechny kapitoly s návazným stránkováním"
                              : "Sestava podle vybraného obsahu"}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Obsah</legend>
              <div className={styles.checks}>
                {Object.entries(REPORT_SECTIONS).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={options.sections.includes(key as ReportSection)}
                      onChange={(e) =>
                        setOptions({
                          ...options,
                          sections: e.target.checked
                            ? [...options.sections, key as ReportSection]
                            : options.sections.filter((s) => s !== key),
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Období a filtry</legend>
              <div className={styles.pair}>
                <label>
                  Od
                  <input
                    type="date"
                    required
                    value={filters.from}
                    max={filters.to}
                    onChange={(e) =>
                      setFilters({ ...filters, from: e.target.value })
                    }
                  />
                </label>
                <label>
                  Do
                  <input
                    type="date"
                    required
                    value={filters.to}
                    min={filters.from}
                    onChange={(e) =>
                      setFilters({ ...filters, to: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                Měna faktur
                <select
                  aria-label="Měna faktur"
                  value={filters.currency}
                  onChange={(e) =>
                    setFilters({ ...filters, currency: e.target.value })
                  }
                >
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Období faktur podle
                <select
                  aria-label="Období faktur podle"
                  value={filters.dateBasis}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      dateBasis: e.target.value as ReportQuery["dateBasis"],
                    })
                  }
                >
                  {Object.entries(REPORT_BASES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Stav faktury
                <select
                  aria-label="Stav faktury"
                  value={filters.status ?? "all"}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      status:
                        e.target.value === "all"
                          ? null
                          : (e.target.value as InvoiceStatus),
                    })
                  }
                >
                  <option value="all">Všechny stavy</option>
                  {Object.entries(REPORT_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Odběratel
                <select
                  aria-label="Odběratel"
                  value={filters.customer ?? "all"}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      customer:
                        e.target.value === "all" ? null : e.target.value,
                    })
                  }
                >
                  <option value="all">Všichni odběratelé</option>
                  {[
                    ...new Set([
                      ...(filters.customer ? [filters.customer] : []),
                      ...customers,
                    ]),
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Možnosti PDF</legend>
              <div className={styles.checks}>
                <label>
                  <input
                    type="checkbox"
                    checked={options.charts}
                    onChange={(e) =>
                      setOptions({ ...options, charts: e.target.checked })
                    }
                  />
                  Zahrnout grafy
                </label>
                <label>
                  <input
                    type="checkbox"
                    disabled={options.mode === "summary"}
                    checked={options.mode !== "summary" && options.details}
                    onChange={(e) =>
                      setOptions({ ...options, details: e.target.checked })
                    }
                  />
                  Zahrnout detailní tabulky
                </label>
                <label>
                  <input
                    type="checkbox"
                    disabled={options.mode === "summary"}
                    checked={options.mode !== "summary" && options.customers}
                    onChange={(e) =>
                      setOptions({ ...options, customers: e.target.checked })
                    }
                  />
                  Rozpis podle odběratelů
                </label>
              </div>
              <label>
                Orientace
                <select
                  aria-label="Orientace"
                  value={options.orientation}
                  onChange={(e) =>
                    setOptions({
                      ...options,
                      orientation: e.target
                        .value as ReportOptions["orientation"],
                    })
                  }
                >
                  <option value="portrait">A4 na výšku</option>
                  <option value="landscape">
                    A4 na šířku — široké tabulky
                  </option>
                </select>
              </label>
            </fieldset>
            <p className={styles.note}>
              Bankovní část používá celé období, celou firmu a všechny měny;
              fakturové filtry ji neomezují. Počet stran roste s detaily,
              záznamy se potichu nevynechávají.
            </p>
            <button
              type="submit"
              className="btn primary"
              disabled={busy || !options.sections.length}
            >
              {busy
                ? "Připravuji PDF…"
                : fresh
                  ? "Obnovit PDF"
                  : "Vytvořit náhled PDF"}
            </button>
            <button
              type="button"
              className={styles.excel}
              disabled={busy || exporting}
              onClick={() => void onExcel()}
            >
              {exporting ? "Připravuji Excel…" : "Původní export do Excelu"}
            </button>
            <small className={styles.note}>
              Excel používá filtry stránky před otevřením tohoto okna a zahrnuje
              faktury, DPH a aging.
            </small>
          </form>
          <section
            className={styles.preview}
            aria-label="Náhled finančního reportu"
            aria-busy={busy}
          >
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            {artifact && !fresh && (
              <p role="status" className={styles.notice}>
                Nastavení se změnilo. Vytvořte nový náhled; původní PDF se podle
                nových filtrů nestahuje ani netiskne.
              </p>
            )}
            {busy ? (
              <div className={styles.empty} role="status">
                <Icon name="document" />
                <strong>Sestavuji finanční report</strong>
                <p>Načítám společný stav dat a připravuji všechny strany.</p>
              </div>
            ) : artifact ? (
              <>
                <div className={styles.meta}>
                  {artifact.pages > 0 ? `${artifact.pages} stran · ` : ""}
                  {artifact.file.name}
                  {artifact.generated && (
                    <>
                      {" "}
                      · Vygenerováno{" "}
                      {new Intl.DateTimeFormat("cs-CZ", {
                        timeZone: "Europe/Prague",
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(artifact.generated))}{" "}
                      (Europe/Prague)
                    </>
                  )}
                </div>
                <DocumentPreview file={artifact.file} kind="report" />
              </>
            ) : (
              <div className={styles.empty}>
                <Icon name="document" />
                <h3>Vaše data v přehledném dokumentu</h3>
                <p>
                  Zvolte obsah a vytvořte náhled. Zobrazí se skutečný PDF soubor
                  připravený ke stažení i tisku.
                </p>
              </div>
            )}
          </section>
        </div>
        <footer className={styles.footer}>
          {notice && <p role="status">{notice}</p>}
          <button type="button" className="btn secondary" onClick={close}>
            Zavřít
          </button>
          <div>
            <button
              type="submit"
              form={formId}
              className="btn secondary"
              disabled={busy || !options.sections.length}
            >
              Náhled PDF
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy || !fresh}
              onClick={print}
            >
              <Icon name="document" />
              Tisknout PDF
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !fresh}
              onClick={download}
            >
              <Icon name="download" />
              Stáhnout PDF
            </button>
            {artifact && fresh && (
              <a href={artifact.url} target="_blank" rel="noopener noreferrer">
                Otevřít PDF samostatně
              </a>
            )}
          </div>
        </footer>
        {artifact && (
          <iframe
            ref={frame}
            className={styles.printFrame}
            src={artifact.url}
            title="PDF připravené pro tisk"
            tabIndex={-1}
            aria-hidden
          />
        )}
      </Modal>
    </>
  );
}
