"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { detectLogoType, MAX_LOGO_BYTES } from "@/lib/company-logo-file";
import { CompanyLogo } from "@/components/company-logo";
import { Icon } from "@/components/icons";
import styles from "./company-logo-editor.module.css";

export function CompanyLogoEditor({ src, companyName, canEdit, onSaved }: {
  src: string | null;
  companyName: string;
  canEdit: boolean;
  onSaved: (src: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!message || message.error) return;
    const timer = window.setTimeout(() => setMessage(null), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function update(file: File | null) {
    if (!canEdit || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      let body: FormData | undefined;
      if (file) {
        if (file.size > MAX_LOGO_BYTES) throw new Error("Logo může mít nejvýš 512 kB.");
        if (!detectLogoType(new Uint8Array(await file.slice(0, 16).arrayBuffer()))) {
          throw new Error("Vyberte obrázek PNG, JPEG nebo WebP.");
        }
        body = new FormData();
        body.set("logo", file);
      }
      // The server checks permissions, file contents, dimensions and decoding.
      const data = await apiFetch<{ logo_path: string | null }>("/api/settings/logo", {
        method: file ? "POST" : "DELETE",
        ...(body ? { body } : {}),
      });
      onSaved(data.logo_path);
      setMessage({ error: false, text: file ? "Logo je uložené." : "Logo firmy je odebrané." });
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "Logo se nepodařilo změnit. Zkuste to znovu." });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="reminder-company-logo-title" aria-busy={busy}>
      <div>
        <h3 id="reminder-company-logo-title">Logo firmy</h3>
        <p>Objeví se v hlavičce upomínek. Je společné pro všechny šablony i vaši firmu v aplikaci.</p>
      </div>
      <div className={styles.row}>
        <div className={styles.preview}>
          <CompanyLogo src={src} name={companyName} />
          {message && !message.error ? <span className={styles.saved} role="status" title={message.text}>
            <Icon name="check" />
            <span className={styles.srOnly}>{message.text}</span>
          </span> : null}
        </div>
        <div className={styles.controls}>
          {canEdit ? <>
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className={styles.fileInput} tabIndex={-1} aria-label="Soubor s logem firmy" disabled={busy} onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void update(file);
            }} />
            <div className={styles.buttons}>
              <button type="button" className="btn secondary" disabled={busy} onClick={() => input.current?.click()}><Icon name="upload" />{busy ? "Ukládám…" : src ? "Změnit logo" : "Nahrát logo"}</button>
              {src ? <button type="button" className={styles.remove} disabled={busy} onClick={() => void update(null)}>Odebrat logo</button> : null}
            </div>
            <p>PNG, JPEG nebo WebP · nejvýš 512 kB a 4096 × 4096 px.</p>
          </> : <p>Logo může změnit administrátor vaší firmy.</p>}
          {!src ? <p>Zatím používáte výchozí logo Splatna.</p> : null}
        </div>
      </div>
      {message?.error ? <p className={styles.error} role="alert">{message.text}</p> : null}
    </section>
  );
}
