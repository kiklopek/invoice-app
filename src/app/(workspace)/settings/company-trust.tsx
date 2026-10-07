"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { CompanyLogo } from "@/components/company-logo";
import { useAccessProfile } from "@/lib/use-access-role";

type Verification = { verified_at: string | null; pending: { data_box_id: string | null; expires_at: string } | null; automatic: boolean };

// Nastavení → Firma: ověření firmy datovou schránkou a logo. Totéž, co
// zakladatel mohl udělat v onboardingu; tady pro ty, kdo to přeskočili.
export function CompanyTrust() {
  const profile = useAccessProfile();
  const { data, mutate } = useSWR<Verification>("/api/verification");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  useEffect(() => { setLogo(profile?.companyLogo ?? null); }, [profile?.companyLogo]);

  async function send() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/verification/data-box", { method: "POST" }).catch(() => null);
    const body = await response?.json().catch(() => null) as { status?: string; dataBoxId?: string; error?: string } | null;
    setMessage(response?.ok && body?.status === "sent"
      ? { ok: true, text: `Kód jsme poslali do datové schránky ${body.dataBoxId}. Platí 72 hodin.` }
      : { ok: false, text: body?.error ?? "Kód se nepodařilo poslat." });
    await mutate();
    setBusy(false);
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/verification/data-box/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null) as { message?: string; error?: string } | null;
    setMessage({ ok: Boolean(response?.ok), text: body?.message ?? body?.error ?? "Kód se nepodařilo ověřit." });
    if (response?.ok) setCode("");
    await mutate();
    setBusy(false);
  }

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

  const verifiedAt = data?.verified_at ? new Date(data.verified_at).toLocaleDateString("cs-CZ") : null;
  return (
    <section className="page-panel company-trust">
      <header>
        <div>
          <h2>Ověření a logo</h2>
          <p>Ověřená firma si může koupit tarif. Logo uvidí zákazníci v upomínkách.</p>
        </div>
      </header>
      <div className="company-trust-row">
        <strong>Ověření firmy</strong>
        {verifiedAt ? (
          <p className="success-message">Firma je ověřená ({verifiedAt}). <Link href="/predplatne">Předplatné</Link></p>
        ) : data?.pending ? (
          <form onSubmit={confirm} className="company-trust-form">
            <label><span>Kód z datové schránky</span><input inputMode="numeric" maxLength={7} value={code} onChange={(event) => setCode(event.target.value.replace(/[^\d\s]/g, ""))} /></label>
            <button className="btn primary" disabled={busy || code.replace(/\s/g, "").length !== 6}>Ověřit firmu</button>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => void send()}>Poslat nový kód</button>
          </form>
        ) : (
          <button type="button" className="btn primary" disabled={busy} onClick={() => void send()}>Poslat kód do datové schránky</button>
        )}
      </div>
      <div className="company-trust-row">
        <strong>Logo</strong>
        <div className="company-trust-logo">
          {logo !== undefined ? <CompanyLogo src={logo} name={profile?.companyName} className="sidebar-company-logo" /> : null}
          <label className="btn secondary">
            {logo ? "Změnit logo" : "Nahrát logo"}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={(event) => void upload(event.target.files?.[0])} />
          </label>
          <small>PNG, JPEG nebo WebP, nejvýš 512 kB</small>
        </div>
      </div>
      {message ? <p aria-live="polite" className={message.ok ? "success-message" : "form-error"}>{message.text}</p> : null}
    </section>
  );
}
