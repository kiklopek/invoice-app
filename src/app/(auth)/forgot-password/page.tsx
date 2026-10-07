"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthShell, authStyles as styles } from "@/components/auth/auth-shell";
import { ArrowRight, Mail } from "@/components/landing/landing-icons";
import { isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { useEntryBrand } from "@/lib/login-entry";
import { HLAVICA_ENTRY } from "@/lib/tenant-entries";

export default function ForgotPasswordPage() {
  const brand = useEntryBrand();
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
    if (!isValidEmail(normalizedEmail)) return setError("Zadejte platnou e-mailovou adresu.");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/password-recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, entry: brand }),
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
    <AuthShell art="phone" brand={brand} claim="Nové heslo za pár minut." claimSub="Pošleme vám bezpečný jednorázový odkaz.">
      <span className={styles.eyebrow}>Obnova přístupu</span>
      <h1 className={styles.title}>Zapomenuté heslo</h1>
      <p className={styles.sub}>Pošleme vám bezpečný odkaz pro nastavení nového hesla.</p>
      {sent ? (
        <div className={styles.sent}>
          <Mail width={22} height={22} />
          <div>
            <strong>Zkontrolujte e-mail</strong>
            <p>Pokud má adresa <b>{email}</b> aktivní účet, obdrží odkaz pro změnu hesla.</p>
          </div>
        </div>
      ) : (
        <form onSubmit={requestReset} className={styles.form}>
          <label className={styles.field}>
            <span>E-mail</span>
            <span className={styles.control}><Mail /><input type="email" inputMode="email" autoComplete="email" required placeholder="jmeno@firma.cz" value={email} onChange={(event) => setEmail(event.target.value)} /></span>
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.primary} disabled={submitting}>
            {submitting ? "Odesílám…" : "Poslat odkaz pro obnovu"} <ArrowRight />
          </button>
        </form>
      )}
      <p className={styles.foot}>Heslo si pamatujete?<Link href={brand === "hlavica" ? HLAVICA_ENTRY.path : "/login"}>Zpět na přihlášení</Link></p>
    </AuthShell>
  );
}
