"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthShell, authStyles as styles } from "@/components/auth/auth-shell";
import { ArrowRight, Mail } from "@/components/landing/landing-icons";
import { useI18n } from "@/i18n/client";
import { isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { useEntryBrand } from "@/lib/login-entry";

export default function ForgotPasswordPage() {
  const brand = useEntryBrand();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const copy = t.auth.forgot;
  const common = t.auth.common;

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason === "expired") setError(copy.errors.expired);
    else if (reason === "technical") setError(copy.errors.technical);
  }, [copy]);

  async function requestReset(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) return setError(common.invalidEmail);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/password-recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, entry: brand }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? copy.errors.rateLimited : copy.errors.sendFailed);
      } else {
        setEmail(normalizedEmail);
        setSent(true);
      }
    } catch {
      setError(copy.errors.sendFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell art="phone" brand={brand} claim={copy.claim} claimSub={copy.claimSub}>
      <span className={styles.eyebrow}>{copy.eyebrow}</span>
      <h1 className={styles.title}>{copy.title}</h1>
      <p className={styles.sub}>{copy.sub}</p>
      {sent ? (
        <div className={styles.sent}>
          <Mail width={22} height={22} />
          <div>
            <strong>{copy.sentTitle}</strong>
            <p>{copy.sentBefore}<b>{email}</b>{copy.sentAfter}</p>
          </div>
        </div>
      ) : (
        <form onSubmit={requestReset} className={styles.form}>
          <label className={styles.field}>
            <span>{common.email}</span>
            <span className={styles.control}><Mail /><input type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" inputMode="email" autoComplete="email" required placeholder={common.emailPlaceholder} value={email} onChange={(event) => setEmail(event.target.value)} /></span>
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.primary} disabled={submitting}>
            {submitting ? common.sending : copy.submit} <ArrowRight />
          </button>
        </form>
      )}
      <p className={styles.foot}>{copy.remember}<Link href="/login">{copy.back}</Link></p>
    </AuthShell>
  );
}
