"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppFrame } from "@/components/app-sidebar";
import { createEmptyInvoice, InvoiceForm } from "@/components/invoice-form";
import type { InvoiceInput } from "@/types/invoice";
import { createCsv } from "@/lib/csv";
import { createClient } from "@/lib/supabase-browser";
import { hasExpectedDocumentSignature, validateDocumentMetadata } from "@/lib/document-validation";
import { Icon } from "@/components/icons";
import type { InvoiceOcrResult } from "@/lib/invoice-ocr";
import { DEFAULT_VAT_RATE, grossFromNet, netFromGross } from "@/lib/vat";

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

export default function ImportInvoicesPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"document" | "csv">("document");
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<InvoiceInput | null>(null);
  const [ocrInfo, setOcrInfo] = useState<Pick<InvoiceOcrResult, "confidence" | "warnings" | "document_kind" | "issuer_matches_organization"> | null>(null);
  const [rows, setRows] = useState<InvoiceInput[]>([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  async function requestExtraction(path: string) {
    const response = await fetch("/api/invoices/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Údaje z dokumentu se nepodařilo načíst.");
    return data.extraction as InvoiceOcrResult;
  }
  async function upload() {
    if (!file) return;
    setWorking(true); setMessage(""); setOcrInfo(null);
    try {
      const metadataError = validateDocumentMetadata(file.type, file.size); if (metadataError) throw new Error(metadataError);
      const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      if (!hasExpectedDocumentSignature(signature, file.type)) throw new Error("Obsah souboru neodpovídá jeho typu.");
      const response = await fetch("/api/invoices/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: file.name, mime: file.type, size: file.size }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (!data.demo) {
        const { error } = await createClient().storage.from("invoice-documents").uploadToSignedUrl(data.path, data.token, file, { contentType: file.type });
        if (error) throw new Error("Dokument se nepodařilo přenést do bezpečného úložiště.");
      }
      const verification = await fetch("/api/invoices/upload/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: data.path }) });
      const verified = await verification.json(); if (!verification.ok) throw new Error(verified.error);
      setUploaded({ ...createEmptyInvoice(), source: "manual", file_url: data.path });
      try {
        const extraction = await requestExtraction(data.path);
        setUploaded(extraction.invoice);
        setOcrInfo(extraction);
      } catch (cause) {
        setMessage(`${cause instanceof Error ? cause.message : "OCR se nezdařilo"} Dokument je bezpečně uložený; údaje můžete doplnit ručně nebo OCR zkusit znovu.`);
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Dokument se nepodařilo nahrát.");
    } finally { setWorking(false); }
  }
  async function retryOcr() {
    if (!uploaded?.file_url) return;
    setWorking(true); setMessage("");
    try {
      const extraction = await requestExtraction(uploaded.file_url);
      setUploaded(extraction.invoice); setOcrInfo(extraction);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "OCR se nepodařilo zopakovat."); }
    finally { setWorking(false); }
  }
  async function create(input: InvoiceInput) { const response = await fetch("/api/invoices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); router.push(`/invoices/${data.invoice.id}`); }
  async function loadCsv(selected: File | null) { if (!selected) return; setMessage(""); try { setRows(parseCsv(await selected.text())); } catch (cause) { setRows([]); setMessage(cause instanceof Error ? cause.message : "CSV se nepodařilo načíst."); } }
  async function importCsv() { setWorking(true); setMessage(""); try { const response = await fetch("/api/invoices/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoices: rows }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); router.push("/invoices"); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Import se nepodařilo uložit."); } finally { setWorking(false); } }
  function downloadTemplate() { const csv = createCsv([["Číslo faktury", "Odběratel", "IČO", "E-mail", "Částka bez DPH", "Sazba DPH", "Částka s DPH", "Měna", "Vystavení", "Splatnost", "Variabilní symbol"], ["FV-2026-001", "Ukázkový odběratel s.r.o.", "12345678", "fakturace@example.cz", 10000, 21, 12100, "CZK", "2026-08-01", "2026-08-15", "2026001"]]); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "vzor-importu-faktur.csv"; link.click(); URL.revokeObjectURL(url); }

  return <AppFrame><header className="section-header"><div><Link href="/invoices" className="back-link"><Icon name="arrow-left"/>Zpět na faktury</Link><p>IMPORT</p><h1>Přidat faktury ze souboru</h1><span>Jednu fakturu načtěte z dokumentu, více faktur najednou z CSV.</span></div></header>
    <div className="page-tabs"><button className={mode === "document" ? "active" : ""} onClick={() => setMode("document")}>Fotografie nebo PDF</button><button className={mode === "csv" ? "active" : ""} onClick={() => setMode("csv")}>Hromadný import CSV</button></div>
    {mode === "document" ? uploaded ? <><div className={`import-step-note ${ocrInfo ? "ocr-complete" : "ocr-manual"}`}><div><strong>{ocrInfo ? "Údaje byly předvyplněny z dokumentu" : "Dokument je bezpečně uložený"}</strong><span>{ocrInfo ? `Spolehlivost rozpoznání přibližně ${Math.round(ocrInfo.confidence * 100)} %. Každý údaj před uložením zkontrolujte.` : "Údaje doplňte ručně, nebo zkuste automatické načtení znovu."}</span></div>{!ocrInfo && <button type="button" className="btn secondary compact" disabled={working} onClick={retryOcr}>{working ? "Načítám…" : "Zkusit OCR znovu"}</button>}</div>{ocrInfo?.warnings.length ? <div className="ocr-warnings"><strong>Co je potřeba ověřit</strong><ul>{ocrInfo.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div> : null}<InvoiceForm key={`${uploaded.file_url}-${ocrInfo ? "ocr" : "manual"}`} initial={uploaded} submitLabel="Potvrdit a uložit fakturu" onSubmit={create}/></> : <section className="page-panel import-panel"><div className="import-drop"><span className="large-import-icon"><Icon name="document"/></span><h2>Vyberte dokument faktury</h2><p>Podporujeme PDF, JPG, PNG a WEBP do velikosti 10 MB. Po nahrání se údaje automaticky předvyplní.</p><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => setFile(event.target.files?.[0] ?? null)}/>{file && <strong>{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</strong>}<button className="btn primary" disabled={!file || working} onClick={upload}>{working ? "Nahrávám a načítám údaje…" : <><Icon name="upload"/>Nahrát a načíst údaje</>}</button></div></section>
    : <section className="page-panel import-panel"><div className="csv-help"><h2>Hromadný import faktur</h2><p>CSV musí obsahovat sloupce: Číslo faktury, Odběratel, E-mail, Částka bez DPH, Sazba DPH, Částka s DPH, Měna, Vystavení a Splatnost. Starší soubor s jediným sloupcem Částka zůstává podporovaný jako konečná částka s DPH. Data používejte ve formátu RRRR-MM-DD. Jeden import může obsahovat nejvýše 250 faktur a uloží se vždy celý, nebo vůbec.</p><div className="csv-actions"><input type="file" accept=".csv,text/csv" onChange={event => loadCsv(event.target.files?.[0] ?? null)}/><button type="button" className="btn secondary" onClick={downloadTemplate}><Icon name="download"/>Stáhnout vzor CSV</button></div></div>{rows.length > 0 && <><div className="import-preview invoice-import-preview"><strong>Nalezeno {rows.length} faktur</strong><table><thead><tr><th>Číslo</th><th>Odběratel</th><th>Bez DPH</th><th>S DPH</th><th>Splatnost</th></tr></thead><tbody>{rows.slice(0, 8).map((row, index) => <tr key={`${row.invoice_number}-${index}`}><td data-label="Číslo">{row.invoice_number}</td><td data-label="Odběratel">{row.counterparty_name}</td><td data-label="Bez DPH">{row.amount_without_vat} {row.currency}</td><td data-label="S DPH">{row.amount} {row.currency}</td><td data-label="Splatnost">{row.due_date}</td></tr>)}</tbody></table>{rows.length > 8 && <small>…a dalších {rows.length - 8}</small>}</div><button className="btn primary import-confirm" disabled={working} onClick={importCsv}>{working ? "Importuji…" : <><Icon name="upload"/>Importovat {rows.length} faktur</>}</button></>}</section>}
    {message && <p className="form-error">{message}</p>}
  </AppFrame>;
}
