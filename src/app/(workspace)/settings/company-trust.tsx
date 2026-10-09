"use client";

import { useEffect, useRef, useState } from "react";
import { CompanyLogo } from "@/components/company-logo";
import { useAccessProfile } from "@/lib/use-access-role";
import styles from "./company-trust.module.css";

// Nastavení → Firma: logo firmy. Totéž, co zakladatel mohl nahrát
// v onboardingu; tady pro ty, kdo to přeskočili nebo ho chtějí změnit.
export function CompanyTrust() {
  const profile = useAccessProfile();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  useEffect(() => { setLogo(profile?.companyLogo ?? null); }, [profile?.companyLogo]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.append("logo", file);
    const response = await fetch("/api/settings/logo", { method: "POST", body: form }).catch(() => null);
    const body = await response?.json().catch(() => null) as { logo_path?: string; error?: string } | null;
    if (response?.ok && body?.logo_path) {
      setLogo(body.logo_path);
      setMessage({ ok: true, text: "Logo je nahrané. V navigaci se projeví po obnovení stránky." });
    } else {
      setMessage({ ok: false, text: body?.error ?? "Logo se nepodařilo nahrát." });
    }
    setBusy(false);
  }

  return (
    <section className={styles.panel} aria-labelledby="company-trust-title">
      <header className={styles.header}>
        <div>
          <h2 id="company-trust-title">Logo firmy</h2>
          <p>Logo uvidí zákazníci v upomínkách.</p>
        </div>
      </header>
      <div className={styles.grid}>
      <div className={styles.card}>
        <div className={styles.cardHeading}><h3>Firemní logo</h3></div>
        <p className={styles.description}>Logo se zobrazí zákazníkům v e-mailových upomínkách.</p>
        <div className={styles.logoLayout}>
          <div className={styles.preview}>{logo !== undefined ? <CompanyLogo src={logo} name={profile?.companyName} className={styles.logo} /> : null}</div>
          <div className={styles.logoActions}>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
            {logo ? "Změnit logo" : "Nahrát logo"}
          </button>
          <input ref={fileInput} type="file" aria-label="Soubor firemního loga" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
          <small>PNG, JPEG nebo WebP, nejvýš 512 kB</small>
          </div>
        </div>
      </div>
      </div>
      {message ? <p role="status" className={message.ok ? styles.success : styles.error}>{message.text}</p> : null}
    </section>
  );
}
