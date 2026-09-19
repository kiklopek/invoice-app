"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";

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

// Archiv nahraných výpisů. Data si načítá sám z /api/payments/imports, takže
// hlavní (nahrávací) podstránka je nemusí načítat vůbec.
export function StatementArchive() {
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ imports: ArchiveItem[] }>("/api/payments/imports")
      .then((data) => setArchive(data.imports ?? []))
      .catch(() => setError("Archiv výpisů se nepodařilo načíst."));
  }, []);

  async function download(item: ArchiveItem) {
    try {
      const data = await apiFetch<{ url: string }>(`/api/payments/imports/${item.id}?download=1`);
      window.location.assign(data.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Soubor se nepodařilo stáhnout.");
    }
  }

  return (
    <section className="page-panel data-panel import-archive" id="archiv-vypisu">
      <header className="panel-head">
        <span className="payments-section-number">02</span>
        <div className="payments-section-heading">
          <small>ULOŽENÉ VÝPISY</small>
          <h2>Archiv bankovních výpisů</h2>
          <p>Originály jsou v soukromém úložišti; odkaz platí pouze 60 sekund.</p>
        </div>
        <span className="payments-record-count">{archive.length} {archive.length === 1 ? "výpis" : archive.length > 1 && archive.length < 5 ? "výpisy" : "výpisů"}</span>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}
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
  );
}
