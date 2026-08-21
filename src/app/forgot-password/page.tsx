"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CompanyLogo } from "@/components/company-logo";
import { Icon } from "@/components/icons";
import { isAllowedCorporateEmail, isCorporateEmailRequired, normalizeEmail } from "@/lib/auth-policy";

export default function ForgotPasswordPage() {
  const corporateEmailRequired = isCorporateEmailRequired();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason === "expired") setError("Odkaz je neplatný, vypršel nebo už byl použit. Pošlete si nový.");
    else if (reason === "technical") setError("Obnovu se nepodařilo dokončit kvůli technické chybě. Pošlete si nový odkaz.");
  }, []);

  async function requestReset(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const normalizedEmail = normalizeEmail(email);
    if (!isAllowedCorporateEmail(normalizedEmail)) return setError(corporateEmailRequired ? "Použijte firemní e-mail @hlavica.cz." : "Zadejte platnou e-mailovou adresu.");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/password-recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      if (!response.ok) {
        setError(response.status === 429
          ? "Nový odkaz lze poslat nejdříve za jednu minutu."
          : "Odkaz se nepodařilo odeslat kvůli technické chybě. Zkuste to prosím znovu.");
      } else {
        setEmail(normalizedEmail);
        setSent(true);
      }
    } catch {
      setError("Odkaz se nepodařilo odeslat kvůli technické chybě. Zkuste to prosím znovu.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page auth-page">
      <section className="login-card auth-card">
        <div className="login-brand"><CompanyLogo className="login-company-logo" /></div>
        <div className="login-intro"><span>OBNOVA PŘÍSTUPU</span><h1>Zapomenuté heslo</h1><p>Pošleme vám bezpečný odkaz pro nastavení nového hesla.</p></div>
        {sent ? (
          <div className="login-sent"><Icon name="mail"/><div><strong>Zkontrolujte e-mail</strong><p>Pokud má adresa <b>{email}</b> aktivní účet, obdrží odkaz pro změnu hesla.</p><Link href="/login" className="auth-inline-link">Zpět na přihlášení</Link></div></div>
        ) : (
          <form onSubmit={requestReset} className="auth-form">
            <label><span>Firemní e-mail</span><input type="email" inputMode="email" autoComplete="email" required placeholder="jmeno@hlavica.cz" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <button type="submit" className="btn primary" disabled={submitting}><Icon name="mail"/>{submitting ? "Odesílám…" : "Poslat odkaz pro obnovu"}</button>
            {error && <p className="form-error">{error}</p>}
          </form>
        )}
        <p className="auth-switch"><Link href="/login">← Zpět na přihlášení</Link></p>
      </section>
    </main>
  );
}
