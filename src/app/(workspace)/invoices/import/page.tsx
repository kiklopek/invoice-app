"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppFrame } from "@/components/layout/app-shell";
import { createEmptyInvoice, InvoiceForm } from "@/components/invoice-form";
import type { InvoiceInput } from "@/types/invoice";
import { createClient } from "@/lib/supabase-browser";
import { hasExpectedDocumentSignature, validateDocumentMetadata } from "@/lib/document-validation";
import { Icon } from "@/components/icons";
import type { InvoiceOcrResult } from "@/lib/invoice-ocr";
import { DEFAULT_VAT_RATE, grossFromNet, netFromGross } from "@/lib/vat";

// Mirrors the server-side OCR_PROVIDER switch (extract/route.ts). Next.js
// only exposes env vars prefixed NEXT_PUBLIC_ to client code, and this is a
// deploy-wide setting (not per-request), so a build-time constant is
// accurate here -- it must never silently drift from what the API route
// actually does, since it's the one sentence telling a person their
// document leaves the company. "hybrid" only sends a document to Gemini
// conditionally (when the local parser's own confidence is low), which
// isn't knowable before OCR actually runs -- the disclosure text for it
// says "may", never a flat yes/no.
const OCR_EXTERNAL_AI_DISCLOSURE: "always" | "never" | "maybe" =
  process.env.NEXT_PUBLIC_OCR_PROVIDER === "gemini" ? "always" : process.env.NEXT_PUBLIC_OCR_PROVIDER === "hybrid" ? "maybe" : "never";

type DocumentStage = "idle" | "uploading" | "verifying" | "reading" | "recognizing" | "prefilling";

const documentStageLabel: Record<DocumentStage, string> = {
  idle: "",
  uploading: "Nahrávám dokument…",
  verifying: "Ověřuji dokument…",
  reading: "Čtu PDF nebo obrázek…",
  recognizing: "Rozpoznávám text lokálním OCR…",
  prefilling: "Předvyplňuji fakturu…",
};

function splitRow(row: string, delimiter: string) {
  const values: string[] = []; let value = ""; let quoted = false;
  for (let i = 0; i < row.length; i++) { const char = row[i]; if (char === '"') { if (quoted && row[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; } else if (char === delimiter && !quoted) { values.push(value.trim()); value = ""; } else value += char; }
  values.push(value.trim()); return values;
}

function parseCsv(text: string): InvoiceInput[] {
  const clean = text.replace(/^\uFEFF/, "").trim(); const lines = clean.split(/\r?\n/).filter(Boolean); if (lines.length < 2) return [];
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = splitRow(lines[0], delimiter).map(value => value.toLocaleLowerCase("cs").replaceAll("_", " "));
  const index = (...names: string[]) => headers.findIndex(header => names.includes(header));
  const columns = {
    number: index("číslo faktury", "cislo faktury", "invoice number"), customer: index("odběratel", "odberatel", "counterparty name"),
    ico: index("ičo", "ico"), email: index("e-mail", "email", "counterparty email"),
    net: index("částka bez dph", "castka bez dph", "amount without vat", "net amount"),
    vatRate: index("sazba dph", "dph %", "vat rate"),
    gross: index("částka s dph", "castka s dph", "amount with vat", "gross amount", "částka", "castka", "amount"),
    currency: index("měna", "mena", "currency"), issue: index("vystavení", "vystaveni", "issue date"),
    due: index("splatnost", "due date"), variable: index("variabilní symbol", "variabilni symbol", "variable symbol"),
  };
  if ([columns.number, columns.customer, columns.email, columns.issue, columns.due].some(value => value < 0) || (columns.net < 0 && columns.gross < 0)) {
    throw new Error("CSV musí obsahovat číslo faktury, odběratele, e-mail, částku bez DPH nebo s DPH, vystavení a splatnost.");
  }
  const number = (value: string | undefined) => Number((value ?? "").replace(/\s/g, "").replace(",", "."));
  return lines.slice(1).map(line => {
    const row = splitRow(line, delimiter);
    const hasNet = columns.net >= 0 && row[columns.net] !== "";
    const hasGross = columns.gross >= 0 && row[columns.gross] !== "";
    const vatRate = columns.vatRate >= 0 && row[columns.vatRate] !== "" ? number(row[columns.vatRate]) : hasNet ? DEFAULT_VAT_RATE : 0;
    const amountWithoutVat = hasNet ? number(row[columns.net]) : netFromGross(number(row[columns.gross]), vatRate);
    const amount = hasGross ? number(row[columns.gross]) : grossFromNet(amountWithoutVat, vatRate);
    return { invoice_number: row[columns.number], counterparty_name: row[columns.customer], counterparty_ico: columns.ico >= 0 ? row[columns.ico] : "", counterparty_email: row[columns.email], amount_without_vat: amountWithoutVat, vat_rate: vatRate, amount, currency: columns.currency >= 0 ? row[columns.currency] || "CZK" : "CZK", issue_date: row[columns.issue], due_date: row[columns.due], variable_symbol: columns.variable >= 0 ? row[columns.variable] : "", source: "manual" };
  });
}

type OcrInfo = Pick<InvoiceOcrResult, "confidence" | "warnings" | "document_kind" | "issuer_matches_organization" | "reminder_policy_assignment" | "field_sources">;
type QueueStatus = "pending" | "processing" | "ready" | "saved" | "error";
type QueueItem = {
  file: File;
  status: QueueStatus;
  invoice?: InvoiceInput;
  ocrInfo?: OcrInfo | null;
  error?: string;
};

export default function ImportInvoicesPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"document" | "csv">("document");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [rows, setRows] = useState<InvoiceInput[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [documentStage, setDocumentStage] = useState<DocumentStage>("idle");
  const [message, setMessage] = useState("");
  // Fronta se cte i z asynchronnich callbacku, ktere drzi closure ze
  // starsiho renderu. Driv kvuli tomu create() hledal dalsi nepotvrzenou
  // fakturu ve zastaralem poli: mohl ji nenajit, odejit na /invoices
  // a TISE zahodit zbyle rozpracovane dokumenty.
  const queueRef = useRef<QueueItem[]>(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  // Zpracovani davky sel drive prerusit jen zavrenim panelu -- u dvaceti
  // souboru a pomaleho OCR nebylo jak vystoupit.
  const cancelRef = useRef<AbortController | null>(null);

  const active = queue[activeIndex];
  const uploaded = active?.invoice ?? null;
  const ocrInfo = active?.ocrInfo ?? null;
  const savedInvoiceCount = queue.filter(item => item.status === "saved").length;

  async function requestExtraction(path: string) {
    const response = await fetch("/api/invoices/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
    const body = await response.text();
    let data: { error?: string; extraction?: InvoiceOcrResult };
    try {
      data = JSON.parse(body) as { error?: string; extraction?: InvoiceOcrResult };
    } catch {
      throw new Error(response.status === 504
        ? "OCR trvalo příliš dlouho. Zkuste dokument znovu nebo použijte kvalitnější sken."
        : "OCR služba dokument nedokončila. Zkuste jej znovu nebo údaje vyplňte ručně.");
    }
    if (!response.ok) throw new Error(data.error || "Údaje z dokumentu se nepodařilo načíst.");
    if (!data.extraction) throw new Error("OCR nevrátilo údaje z dokumentu.");
    return data.extraction;
  }
  async function requestDocumentExtraction(path: string) {
    setDocumentStage("reading");
    const recognitionTimer = window.setTimeout(() => setDocumentStage("recognizing"), 900);
    try {
      const extraction = await requestExtraction(path);
      setDocumentStage("prefilling");
      return extraction;
    } finally {
      window.clearTimeout(recognitionTimer);
    }
  }
  async function processOne(file: File, index: number) {
    setQueue(current => current.map((item, i) => i === index ? { ...item, status: "processing" } : item));
    setDocumentStage("uploading");
    try {
      const metadataError = validateDocumentMetadata(file.type, file.size); if (metadataError) throw new Error(metadataError);
      const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      if (!hasExpectedDocumentSignature(signature, file.type)) throw new Error("Obsah souboru neodpovídá jeho typu.");
      const response = await fetch("/api/invoices/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: file.name, mime: file.type, size: file.size }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const { error } = await createClient().storage.from("invoice-documents").uploadToSignedUrl(data.path, data.token, file, { contentType: file.type });
      if (error) throw new Error("Dokument se nepodařilo přenést do bezpečného úložiště.");
      setDocumentStage("verifying");
      const verification = await fetch("/api/invoices/upload/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: data.path }) });
      const verified = await verification.json(); if (!verification.ok) throw new Error(verified.error);
      const baseInvoice: InvoiceInput = { ...createEmptyInvoice(), source: "manual", file_url: data.path };
      try {
        const extraction = await requestDocumentExtraction(data.path);
        setQueue(current => current.map((item, i) => i === index ? { ...item, status: "ready", invoice: extraction.invoice, ocrInfo: extraction } : item));
      } catch (cause) {
        const detail = `${cause instanceof Error ? cause.message : "OCR se nezdařilo"} Dokument je bezpečně uložený; údaje můžete doplnit ručně nebo OCR zkusit znovu.`;
        setQueue(current => current.map((item, i) => i === index ? { ...item, status: "ready", invoice: baseInvoice, ocrInfo: null, error: detail } : item));
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Dokument se nepodařilo nahrát.";
      setQueue(current => current.map((item, i) => i === index ? { ...item, status: "error", error: detail } : item));
    }
  }
  async function uploadQueue() {
    if (!queue.length) return;
    const controller = new AbortController();
    cancelRef.current = controller;
    setWorking(true); setMessage("");
    // Processed one at a time on purpose: OCR runs locally (CPU-bound Tesseract),
    // so racing several documents at once would just slow each of them down.
    for (let index = 0; index < queue.length; index += 1) {
      if (controller.signal.aborted) break;
      await processOne(queue[index].file, index);
    }
    cancelRef.current = null;
    setDocumentStage("idle"); setWorking(false);
    if (controller.signal.aborted) {
      // Uz zpracovane dokumenty zustavaji -- zrusit znamena "dal uz nepokracuj",
      // ne "zahod, co je hotove".
      const pending = queueRef.current.filter(item => item.status === "pending").length;
      setMessage(pending ? `Zpracování zastaveno, ${pending} dokument(ů) zůstalo nenačtených.` : "Zpracování zastaveno.");
    }
    setActiveIndex(0);
  }

  function cancelProcessing() {
    cancelRef.current?.abort();
  }

  // Chybný dokument musí jít zkusit znovu nebo vynechat. Bez toho zbýval
  // u jednoho souboru jen reload stránky, u fronty se z něj nedalo hnout.
  async function retryDocument(index: number) {
    const item = queueRef.current[index];
    if (!item || working) return;
    setWorking(true); setMessage("");
    try {
      await processOne(item.file, index);
    } finally {
      setWorking(false); setDocumentStage("idle");
    }
  }

  // Text v ploše přetažení slibuje ("sem soubory přetáhněte"), ale žádný
  // onDrop neexistoval -- fungoval jen nativní drop přímo na skrytý input,
  // ne na okolní plochu. Uživatel to přečetl, zkusil a nic se nestalo.
  const [dragActive, setDragActive] = useState(false);

  function acceptDroppedFiles(event: React.DragEvent, onFiles: (files: File[]) => void) {
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) onFiles(files);
  }

  function skipDocument(index: number) {
    const remaining = queueRef.current.filter((_, i) => i !== index);
    queueRef.current = remaining;
    setQueue(remaining);
    // Zůstat na stejné pozici, pokud tam ještě něco je; jinak o jednu zpět.
    setActiveIndex(current => Math.max(0, Math.min(current, remaining.length - 1)));
    if (!remaining.length) setMessage("Fronta je prázdná, všechny dokumenty byly vyřízené nebo přeskočené.");
  }
  async function retryOcr() {
    if (!uploaded?.file_url) return;
    const index = activeIndex;
    setWorking(true); setDocumentStage("reading"); setMessage("");
    try {
      const extraction = await requestDocumentExtraction(uploaded.file_url);
      setQueue(current => current.map((item, i) => i === index ? { ...item, invoice: extraction.invoice, ocrInfo: extraction, error: undefined } : item));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "OCR se nepodařilo zopakovat."); }
    finally { setWorking(false); setDocumentStage("idle"); }
  }
  async function create(input: InvoiceInput) {
    const response = await fetch("/api/invoices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const savedIndex = activeIndex;
    // Cerstvy stav z ref, ne ze zastarale closure -- jinak se muze stat, ze
    // se dalsi pripravena faktura nenajde a zbytek fronty se tise zahodi.
    const updated = queueRef.current.map((item, i) => i === savedIndex ? { ...item, status: "saved" as const } : item);
    queueRef.current = updated;
    setQueue(updated);
    const nextReady = updated.findIndex((item, i) => i !== savedIndex && item.status === "ready");
    if (nextReady >= 0) { setActiveIndex(nextReady); return; }
    const unfinished = updated.filter(item => item.status === "pending" || item.status === "processing").length;
    if (unfinished > 0) {
      // Nikdy neodejit a nenechat rozpracovane dokumenty zmizet bez zminky.
      setMessage(`Zbývá ${unfinished} nenačtený dokument(ů) ve frontě.`);
      return;
    }
    if (updated.length <= 1) router.push(`/invoices/${data.invoice.id}`);
    else router.push("/invoices");
  }
  async function loadCsv(selected: File | null) { if (!selected) return; setCsvFile(selected); setMessage(""); try { setRows(parseCsv(await selected.text())); } catch (cause) { setRows([]); setMessage(cause instanceof Error ? cause.message : "CSV se nepodařilo načíst."); } }
  async function importCsv() { setWorking(true); setMessage(""); try { const response = await fetch("/api/invoices/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoices: rows }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); router.push("/invoices"); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Import se nepodařilo uložit."); } finally { setWorking(false); } }

  return <AppFrame>
    <header className="section-header"><div><Link href="/invoices" className="back-link"><Icon name="arrow-left"/>Zpět na faktury</Link><p>IMPORT</p><h1>Přidat faktury ze souboru</h1><span>Jednu fakturu načtěte z dokumentu, více faktur najednou z CSV.</span></div></header>
    <div className="page-tabs invoice-import-tabs"><button className={mode === "document" ? "active" : ""} onClick={() => setMode("document")}>Fotografie nebo PDF</button><button className={mode === "csv" ? "active" : ""} onClick={() => setMode("csv")}>Hromadný import CSV</button></div>
    <div className="invoice-import-workspace">
    {working && documentStage !== "idle" && <div className="import-progress" role="status" aria-live="polite"><span className="import-progress-spinner" aria-hidden="true"/><strong>{documentStageLabel[documentStage]}</strong>{queue.length > 1 && <button type="button" className="btn secondary compact import-cancel" onClick={cancelProcessing}>Zastavit zpracování</button>}</div>}
    {mode === "document" ? (
      queue.length === 0 ? (
        <section className="page-panel import-panel invoice-document-import">
          <label
            className={`import-drop invoice-document-dropzone${dragActive ? " is-dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => acceptDroppedFiles(event, (files) => {
              setQueue(files.map(selectedFile => ({ file: selectedFile, status: "pending" })));
              setActiveIndex(0);
              setMessage("");
            })}
          >
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => { const files = Array.from(event.target.files ?? []); if (files.length) { setQueue(files.map(selectedFile => ({ file: selectedFile, status: "pending" }))); setActiveIndex(0); setMessage(""); } }}/>
            <span className="large-import-icon"><Icon name="document"/></span>
            <h2>Vyberte dokumenty faktur</h2>
            <p>
              Podporujeme textová i naskenovaná PDF, JPG, PNG a WEBP do velikosti 10 MB na soubor. Vybrat lze i více souborů najednou.{" "}
              {OCR_EXTERNAL_AI_DISCLOSURE === "always"
                ? "Údaje rozpozná externí AI služba -- dokument se jí kvůli tomu odešle."
                : OCR_EXTERNAL_AI_DISCLOSURE === "maybe"
                  ? "Údaje rozpozná lokální OCR; pokud si nebude jistý, dokument navíc pošleme ke kontrole externí AI službě."
                  : "Údaje rozpozná lokální OCR bez odesílání do externí AI služby."}
            </p>
            <span className="import-drop-action"><Icon name="upload"/>Vybrat dokumenty</span>
            <small>Klikněte kamkoliv do plochy nebo sem soubory přetáhněte</small>
          </label>
        </section>
      ) : !queue.some(item => item.status !== "pending") ? (
        <section className="page-panel import-panel">
          <div className="import-drop">
            <h2>{queue.length === 1 ? "1 vybraný dokument" : `${queue.length} vybraných dokumentů`}</h2>
            <ul className="import-queue-list">
              {queue.map((item, index) => <li key={index}>{item.file.name} · {(item.file.size / 1024 / 1024).toFixed(2)} MB</li>)}
            </ul>
            <div className="import-queue-actions">
              <button type="button" className="btn secondary" disabled={working} onClick={() => { setQueue([]); setActiveIndex(0); }}>Zrušit výběr</button>
              <button className="btn primary" disabled={working} onClick={uploadQueue}>{working ? documentStageLabel[documentStage] : <><Icon name="upload"/>{queue.length === 1 ? "Nahrát a načíst údaje" : `Nahrát a načíst ${queue.length} dokumentů`}</>}</button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {queue.length > 1 && (
            <>
              <div className="import-queue-summary" role="status" aria-live="polite">
                <strong>Potvrzeno {savedInvoiceCount}/{queue.length} faktur</strong>
                <div
                  className="import-queue-progress-track"
                  role="progressbar"
                  aria-label="Průběh potvrzování faktur"
                  aria-valuemin={0}
                  aria-valuemax={queue.length}
                  aria-valuenow={savedInvoiceCount}
                >
                  <span style={{ width: `${(savedInvoiceCount / queue.length) * 100}%` }}/>
                </div>
              </div>
              <div className="import-queue-tabs" role="tablist" aria-label="Fronta dokumentů">
                {queue.map((item, index) => (
                  <button
                    key={index}
                    type="button"
                    role="tab"
                    aria-selected={index === activeIndex}
                    className={`import-queue-tab ${item.status}${index === activeIndex ? " active" : ""}`}
                    disabled={item.status === "pending" || item.status === "processing"}
                    onClick={() => setActiveIndex(index)}
                  >
                    <span>{item.file.name}</span>
                    <small>{item.status === "pending" ? "Čeká" : item.status === "processing" ? "Zpracovávám…" : item.status === "ready" ? "Ke kontrole" : item.status === "saved" ? "Potvrzeno" : "Chyba"}</small>
                  </button>
                ))}
              </div>
            </>
          )}
          {active?.status === "error" ? (
            /* Dřív tu byla jen chybová věta a nic víc -- slepá ulička, ze
               které se u jednoho souboru dalo dostat jen reloadem stránky.
               Každá chyba teď nabízí, co s ní dál. */
            <section className="page-panel invoice-import-error">
              <p className="form-error">{active.error}</p>
              <div className="invoice-import-error-actions">
                <button type="button" className="btn primary" disabled={working} onClick={() => void retryDocument(activeIndex)}>
                  Zkusit znovu
                </button>
                {queue.length > 1 && (
                  <button type="button" className="btn secondary" disabled={working} onClick={() => skipDocument(activeIndex)}>
                    Přeskočit dokument
                  </button>
                )}
                <Link className="btn secondary" href="/invoices/new">Vyplnit ručně</Link>
              </div>
            </section>
          ) : active?.status === "processing" || active?.status === "pending" ? (
            <section className="page-panel"><p className="page-state">{documentStageLabel[documentStage] || "Čeká na zpracování…"}</p></section>
          ) : uploaded ? <>
            <div className={`import-step-note ${ocrInfo ? "ocr-complete" : "ocr-manual"}`}>
              <div><strong>{ocrInfo ? "Údaje byly předvyplněny z dokumentu" : "Dokument je bezpečně uložený"}</strong><span>{ocrInfo ? `Spolehlivost rozpoznání přibližně ${Math.round(ocrInfo.confidence * 100)} %. Každý údaj před uložením zkontrolujte.` : "Údaje doplňte ručně, nebo zkuste automatické načtení znovu."}</span></div>
              {!ocrInfo && <div className="ocr-manual-actions"><button type="button" className="btn secondary compact" disabled={working} onClick={retryOcr}>{working ? documentStageLabel[documentStage] : "Zkusit OCR znovu"}</button><a className="btn secondary compact" href="#manual-invoice-form">Vyplnit ručně</a></div>}
            </div>
            <div id="manual-invoice-form"><InvoiceForm key={`${uploaded.file_url}-${ocrInfo ? "ocr" : "manual"}`} initial={uploaded} policyAssignment={ocrInfo?.reminder_policy_assignment} ocrFieldSources={ocrInfo?.field_sources} ocrWarnings={ocrInfo?.warnings} submitLabel="Potvrdit a uložit fakturu" onSubmit={create}/></div>
          </> : null}
        </>
      )
    ) : <section className="page-panel import-panel csv-import-panel">
      <div className="csv-import-grid">
        <div className="csv-import-main">
          <span className="csv-eyebrow">HROMADNÝ IMPORT</span>
          <h2>Načtěte faktury z CSV</h2>
          <p className="csv-lead">Nahrajte připravený soubor a před uložením zkontrolujte náhled. Import proběhne celý, nebo se neuloží nic.</p>
          <label
            className={`csv-dropzone${csvFile ? " has-file" : ""}${dragActive ? " is-dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => acceptDroppedFiles(event, (files) => void loadCsv(files[0] ?? null))}
          >
            <input type="file" accept=".csv,text/csv" onChange={event => loadCsv(event.target.files?.[0] ?? null)}/>
            <span className="csv-dropzone-icon"><Icon name={csvFile ? "check" : "upload"}/></span>
            <strong>{csvFile ? csvFile.name : "Vyberte CSV soubor"}</strong>
            <small>{csvFile ? `${(csvFile.size / 1024).toFixed(1)} kB · kliknutím můžete soubor změnit` : "Klikněte nebo soubor přetáhněte do této plochy"}</small>
            {!csvFile && <span className="csv-file-button">Vybrat soubor</span>}
          </label>
        </div>
      </div>
      {rows.length > 0 && <><div className="import-preview invoice-import-preview"><strong>Nalezeno {rows.length} faktur</strong><table><thead><tr><th>Číslo</th><th>Odběratel</th><th>Bez DPH</th><th>S DPH</th><th>Splatnost</th></tr></thead><tbody>{rows.slice(0, 8).map((row, index) => <tr key={`${row.invoice_number}-${index}`}><td data-label="Číslo">{row.invoice_number}</td><td data-label="Odběratel">{row.counterparty_name}</td><td data-label="Bez DPH">{row.amount_without_vat} {row.currency}</td><td data-label="S DPH">{row.amount} {row.currency}</td><td data-label="Splatnost">{row.due_date}</td></tr>)}</tbody></table>{rows.length > 8 && <small>…a dalších {rows.length - 8}</small>}</div><div className="csv-import-footer"><span><Icon name="check"/>Soubor je připravený k importu</span><button className="btn primary" disabled={working} onClick={importCsv}>{working ? "Importuji…" : <><Icon name="upload"/>Importovat {rows.length} faktur</>}</button></div></>}
    </section>}
    {message && <p className="form-error">{message}</p>}
    </div>
  </AppFrame>;
}
