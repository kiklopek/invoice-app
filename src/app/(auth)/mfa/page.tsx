"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AuthShell, authStyles as styles } from "@/components/auth/auth-shell";
import { OtpInput } from "@/components/auth/otp-input";
import { ArrowLeft, ArrowRight } from "@/components/landing/landing-icons";
import { signOutCurrentSession } from "@/lib/sign-out";
import { safeReturnPath } from "@/lib/safe-return-path";
import { currentEntryLoginPath, useEntryBrand } from "@/lib/login-entry";
import { useI18n } from "@/i18n/client";
import { mfaApiError } from "@/i18n/api-errors";

export default function MfaPage() {
  const brand = useEntryBrand();
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
  const { locale, t } = useI18n();
  const copy = t.auth.mfa;
  const common = t.auth.common;

  async function signOutAndReturnToLogin() {
    setSigningOut(true);
    try {
      await signOutCurrentSession();
    } catch {
      // Odhlášení serveru se nemuselo podařit; přesto uživatele vrátíme na přihlášení.
    } finally {
      window.location.replace(currentEntryLoginPath());
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
        window.location.replace(currentEntryLoginPath());
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
        setError(mfaApiError(locale, data, copy.errors.sendFailed));
        return;
      }
      setCodeAvailable(true);
      setCooldown(60);
    } catch {
      setError(copy.errors.sendOffline);
    } finally {
      setLoading(false);
      setResending(false);
    }
  }, [locale, copy]);

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
      setError(copy.errors.invalidCode);
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
      setError(mfaApiError(locale, data, copy.errors.verifyFailed));
      setCode("");
    } catch {
      setError(copy.errors.verifyOffline);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      art="phone"
      brand={brand}
      claim={<>{copy.claim1}<br />{copy.claim2}</>}
      claimSub={copy.claimSub}
    >
      <span className={styles.eyebrow}>{copy.eyebrow}</span>
      <h1 className={styles.title}>{copy.title}</h1>
      <p className={styles.sub}>
        {loading
          ? copy.sending
          : codeAvailable
            ? <>{copy.sentBefore}<b>{email || copy.fallbackEmail}</b>{copy.sentAfter}</>
            : copy.notSent}
      </p>

      {!loading && codeAvailable && (
        <form onSubmit={verify} className={styles.form}>
          <OtpInput value={code} onChange={setCode} disabled={submitting} autoFocus />
          <small className={styles.note} style={{ marginTop: -4 }}>{copy.validity}</small>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.primary} disabled={submitting || code.length !== 6}>
            {submitting ? copy.submitting : copy.submit} <ArrowRight />
          </button>
        </form>
      )}

      {(loading || !codeAvailable) && error && <p className={styles.error} style={{ marginTop: 24 }}>{error}</p>}

      {!loading && (
        <p className={styles.resend} style={{ marginTop: 22 }}>
          {copy.noCode}
          <button
            type="button"
            className={styles.textButton}
            disabled={resending || cooldown > 0}
            onClick={() => void requestCode(true)}
          >
            {resending ? common.sending : cooldown > 0 ? copy.resendIn(cooldown) : copy.resend}
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
          <ArrowLeft /> {signingOut ? common.signingOut : copy.back}
        </button>
      )}
    </AuthShell>
  );
}
