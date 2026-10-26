"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/components/icons";
import styles from "./invoice-detail.module.css";

const Thumbnail = dynamic(() => import("@/components/document-preview").then(mod => mod.DocumentThumbnail), { ssr: false, loading: () => <span>Načítání náhledu…</span> });
export function InvoiceDocumentCard({ id, path, invoiceNumber }: { id: string; path: string | null; invoiceNumber: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const url = `/api/invoices/${id}/document`;
  useEffect(() => {
    setFile(null); setFailed(false);
    if (!path) return;
    const controller = new AbortController();
    void (async () => {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("document_unavailable");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const name = path.split("/").at(-1) || `${invoiceNumber}.pdf`;
      setFile(new File([blob], name, { type: blob.type }));
    })().catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [url, path, invoiceNumber, attempt]);
  return <section className={`${styles.card} ${styles.document}`} aria-label="Dokument faktury">
    <header><h2>Dokument faktury</h2>{path && <a className={styles.iconButton} href={url} target="_blank" rel="noreferrer" aria-label="Otevřít originální dokument"><Icon name="document" /></a>}</header>
    {path ? <div className={styles.documentBody}>
      <a className={styles.thumbnail} href={url} target="_blank" rel="noreferrer" aria-label="Otevřít náhled originálního dokumentu">
        {file ? <Thumbnail file={file} /> : <span role="status">{failed ? "Náhled není dostupný" : "Načítání náhledu…"}</span>}
      </a>
      <div className={styles.documentInfo}><strong title={file?.name}>{file?.name ?? `${invoiceNumber} · originál`}</strong>
        {file && <small>{new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(file.size / 1024)} KB</small>}
        {failed && <button type="button" className={styles.textButton} onClick={() => setAttempt(value => value + 1)}>Zkusit náhled znovu</button>}
        <a className={styles.secondaryButton} href={`${url}?download=1`}><Icon name="download" />Stáhnout dokument</a>
      </div>
    </div> : <div className={styles.empty}><p>K této faktuře není přiložen dokument.</p><a className={styles.textButton} href={`/api/invoices/${id}/pdf`} target="_blank" rel="noreferrer">Stáhnout vytvořené PDF <Icon name="download" /></a></div>}
  </section>;
}
