"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AuthShell, authStyles as styles } from "@/components/auth/auth-shell";
import { OtpInput } from "@/components/auth/otp-input";
import { ArrowLeft, ArrowRight } from "@/components/landing/landing-icons";
import { signOutCurrentSession } from "@/lib/sign-out";
import { safeReturnPath } from "@/lib/safe-return-path";

export default function MfaPage() {
  const requested = useRef(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeAvailable, setCodeAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function signOutAndReturnToLogin() {
    setSigningOut(true);
    try {
      await signOutCurrentSession();
    } catch {
      // Odhlášení serveru se nemuselo podařit; přesto uživatele vrátíme na přihlášení.
    } finally {
      window.location.replace("/login");
    }
  }

  const requestCode = useCallback(async (resend = false) => {
    if (resend) setResending(true);
    else setLoading(true);
    if (!resend) setCodeAvailable(false);
    setError(null);
    try {
      const response = await fetch("/api/auth/email-mfa/send", { method: "POST", credentials: "same-origin" });
      const data = await response.json().catch(() => ({})) as {
        can_verify?: boolean;
        code?: string;
        email?: string;
        error?: string;
        retry_after?: number;
        verified?: boolean;
      };
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (data.verified) {
        // Cil prenesený z prihlaseni pres ?returnTo -- bez toho by se
        // uzivatel po MFA vzdy vratil na /dashboard misto tam, kam mířil.
        window.location.replace(safeReturnPath(new URLSearchParams(window.location.search).get("returnTo")));
        return;
      }
      if (data.email) setEmail(data.email);
      if (typeof data.retry_after === "number") setCooldown(Math.max(1, Math.ceil(data.retry_after)));
      if (!response.ok) {
        setCodeAvailable(data.can_verify === true);
        setError(data.error || "Kód se nepodařilo odeslat.");
        return;
      }
      setCodeAvailable(true);
      setCooldown(60);
    } catch {
      setError("Kód se nepodařilo odeslat. Zkontrolujte připojení.");
    } finally {
      setLoading(false);
      setResending(false);
    }
  }, []);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void requestCode();
  }, [requestCode]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Zadejte platný šestimístný kód.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/email-mfa/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await response.json().catch(() => ({})) as { code?: string; error?: string; verified?: boolean };
      if (response.ok && data.verified) {
        // Cil prenesený z prihlaseni pres ?returnTo -- bez toho by se
        // uzivatel po MFA vzdy vratil na /dashboard misto tam, kam mířil.
        window.location.replace(safeReturnPath(new URLSearchParams(window.location.search).get("returnTo")));
        return;
      }
      if (data.code === "challenge_expired" || data.code === "challenge_missing") setCodeAvailable(false);
      setError(data.error || "Kód se nepodařilo ověřit.");
      setCode("");
    } catch {
      setError("Kód se nepodařilo ověřit. Zkontrolujte připojení.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      art="phone"
      claim={<>Vaše bezpečí<br />je pro nás důležité.</>}
      claimSub="Dvoufázové ověření pomáhá chránit vaše data a faktury."
    >
      <span className={styles.eyebrow}>Ověření e-mailem</span>
      <h1 className={styles.title}>Ověření ve 2 krocích</h1>
      <p className={styles.sub}>
        {loading
          ? "Odesíláme jednorázový kód…"
          : codeAvailable
            ? <>Zadejte kód, který jsme vám právě poslali na e-mail <b>{email || "váš firemní e-mail"}</b>.</>
            : "Ověřovací kód zatím nebyl odeslán."}
      </p>

      {!loading && codeAvailable && (
        <form onSubmit={verify} className={styles.form}>
          <OtpInput value={code} onChange={setCode} disabled={submitting} autoFocus />
          <small className={styles.note} style={{ marginTop: -4 }}>Kód platí 10 minut, lze jej použít pouze jednou a po pěti chybných pokusech se zablokuje.</small>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.primary} disabled={submitting || code.length !== 6}>
            {submitting ? "Ověřuji…" : "Ověřit a pokračovat"} <ArrowRight />
          </button>
        </form>
      )}

      {(loading || !codeAvailable) && error && <p className={styles.error} style={{ marginTop: 24 }}>{error}</p>}

      {!loading && (
        <p className={styles.resend} style={{ marginTop: 22 }}>
          Nepřišel vám kód?
          <button
            type="button"
            className={styles.textButton}
            disabled={resending || cooldown > 0}
            onClick={() => void requestCode(true)}
          >
            {resending ? "Odesílám…" : cooldown > 0 ? `Poslat znovu (${cooldown} s)` : "Poslat znovu"}
          </button>
        </p>
      )}
      {!loading && (
        <button
          type="button"
          className={`${styles.textButton} ${styles.back}`}
          disabled={signingOut}
          onClick={() => void signOutAndReturnToLogin()}
        >
          <ArrowLeft /> {signingOut ? "Odhlašuji…" : "Zpět na přihlášení jiným účtem"}
        </button>
      )}
    </AuthShell>
  );
}
