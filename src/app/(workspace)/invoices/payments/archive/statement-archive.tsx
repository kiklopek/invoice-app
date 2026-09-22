"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { confirmAction } from "@/lib/confirm-action";

type ArchiveItem = {
  id: string;
  original_filename: string;
  status: string;
  revision: number;
  entry_count: number;
  accepted_count: number;
  ignored_count: number;
  error_count: number;
  created_at: string;
  committed_at: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  committed: "Potvrzeno",
  discarded: "Zahozeno",
  failed: "Chyba zpracování",
  committing: "Zaúčtovává se",
  review: "Ke kontrole",
};

// Zahodit jde jen výpis, ze kterého ještě nevznikly platby. Stav 'committing'
// mezi ně nepatří -- v tu chvíli se zapisují peníze na faktury.
const DISCARDABLE = new Set(["review", "failed"]);

// Archiv nahraných výpisů. Data si načítá sám z /api/payments/imports, takže
// hlavní (nahrávací) podstránka je nemusí načítat vůbec.
export function StatementArchive() {
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [error, setError] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [working, setWorking] = useState("");

  useEffect(() => {
    apiFetch<{ imports: ArchiveItem[]; can_manage?: boolean }>("/api/payments/imports")
      .then((data) => {
        setArchive(data.imports ?? []);
        setCanManage(data.can_manage === true);
      })
      .catch(() => setError("Archiv výpisů se nepodařilo načíst."));
  }, []);

  async function discard(item: ArchiveItem) {
    const confirmed = await confirmAction({
      title: "Zahodit tento výpis?",
      description: `Výpis „${item.original_filename}“ (${item.entry_count} ${item.entry_count === 1 ? "položka" : item.entry_count >= 2 && item.entry_count <= 4 ? "položky" : "položek"}) se přestane nabízet ke kontrole. Zůstane v archivu i s původním souborem, ale nepůjde ho už zaúčtovat.`,
      confirmLabel: "Zahodit výpis",
    });
    if (!confirmed) return;
    setError("");
    setWorking(item.id);
    try {
      await apiFetch(`/api/payments/imports/${item.id}/discard`, {
        method: "POST",
        body: JSON.stringify({ revision: item.revision }),
      });
      const data = await apiFetch<{ imports: ArchiveItem[] }>("/api/payments/imports");
      setArchive(data.imports ?? []);
    } catch (cause) {
      // Nejčastější případ je, že z výpisu už jsou zaúčtované platby. To není
      // chyba uživatele, ale informace -- proto celá věta, ne kód.
      setError(cause instanceof Error ? cause.message : "Výpis se nepodařilo zahodit.");
    } finally {
      setWorking("");
    }
  }

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
              <span className={`statement-status ${item.status === "committed" ? "committed" : item.status === "discarded" ? "discarded" : "review"}`}>
                {STATUS_LABELS[item.status] ?? "Ke kontrole"}
              </span>
              {canManage && DISCARDABLE.has(item.status) && (
                <button
                  type="button"
                  className="btn secondary compact"
                  disabled={working === item.id}
                  onClick={() => discard(item)}
                  aria-label={`Zahodit ${item.original_filename}`}
                >
                  {working === item.id ? "Zahazuji…" : "Zahodit"}
                </button>
              )}
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
