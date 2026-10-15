"use client";

import { PasswordInput } from "@/components/auth/password-input";
import { OtpInput } from "@/components/auth/otp-input";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthShell, authStyles as styles, type AuthBrand } from "@/components/auth/auth-shell";
import { useI18n } from "@/i18n/client";
import { ArrowRight, Lock, Mail, User } from "@/components/landing/landing-icons";
import { CUSTOM_ENTRY_EMAIL_DOMAIN, emailMatchesDomain, isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { CUSTOM_ENTRY_REGISTRATION_PATH, isCustomEntryBrand } from "@/lib/tenant-entries";
import { passwordRule } from "@/lib/password-policy";
import { hasSupabaseBrowserConfig } from "@/lib/supabase-config";
import { VERIFICATION_CODE_LENGTH as CODE_LENGTH } from "@/lib/verification-code";

// Registrace. Dva oddělené vstupy:
// - "splatno" (/register): kdo nemá pozvánku, zakládá firemní účet a po
//   jednom ověření kódem projde onboardingem; kdo pozvánku má, se po
//   ověření připojí ke své firmě. S R. Hlavica nesouvisí.
// - "hlavica" (/hlavica/registrace): jako dřív, jen e-mail @hlavica.cz,
//   který administrátor R. Hlavica předem pozval.
export function RegisterForm({ brand }: { brand: AuthBrand }) {
  const customEntry = isCustomEntryBrand(brand);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t, locale } = useI18n();
  const copy = t.auth.register;
  const common = t.auth.common;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000))), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown, resendAt]);

  async function register(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    const normalizedEmail = normalizeEmail(email);
    if (fullName.trim().length < 3) return setError(copy.errors.fullName);
    if (!isValidEmail(normalizedEmail)) return setError(common.invalidEmail);
    if (customEntry && !emailMatchesDomain(normalizedEmail, CUSTOM_ENTRY_EMAIL_DOMAIN)) return setError(copy.errors.domainOnly(CUSTOM_ENTRY_EMAIL_DOMAIN));
    const rule = passwordRule(password);
    if (rule) return setError(common.passwordRules[rule]);
    if (password !== confirmation) return setError(common.passwordsMismatch);
    if (!customEntry && !acceptTerms) return setError(copy.errors.terms);
    if (!hasSupabaseBrowserConfig()) return setError(copy.errors.notConfigured);

    setSubmitting(true);
    try {
      const accessResponse = await fetch("/api/auth/registration-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, entry: brand }),
      });
      if (!accessResponse.ok) {
        setError(copy.errors.accessCheck);
        return;
      }
      const access = (await accessResponse.json()) as { allowed?: boolean; kind?: string };
      if (!access.allowed) {
        setError(access.kind === "member"
          ? copy.errors.member
          : access.kind === "custom_entry"
            ? "custom_entry"
            : access.kind === "disposable"
              ? copy.errors.disposable
              : copy.errors.notInvited);
        return;
      }

      const response = await registrationRequest("send", normalizedEmail);
      if (!response.ok) {
        setError(await registrationSendError(response));
        return;
      }
      setCooldown(60);
      setResendAt(Date.now() + 60_000);
      setEmail(normalizedEmail);
      setSent(true);
    } catch {
      setError(copy.errors.connection);
    } finally {
      setSubmitting(false);
    }
  }

  function registrationRequest(action: "send" | "verify", normalizedEmail = email) {
    return fetch("/api/auth/register", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, email: normalizedEmail, password, fullName: fullName.trim(), acceptTerms, entry: brand, locale, ...(action === "verify" ? { code } : {}) }),
    });
  }

  async function registrationSendError(response: Response) {
    const result = await response.json().catch(() => null) as { code?: string } | null;
    if (response.status === 429) return copy.errors.rateLimited;
    return ["email_unavailable", "email_delivery_failed", "local_email_blocked"].includes(result?.code ?? "")
      ? copy.errors.emailDelivery
      : copy.errors.signUp;
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || resending || code.length !== CODE_LENGTH) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await registrationRequest("verify");
      const result = await response.json().catch(() => null) as { redirect?: string; code?: string } | null;
      if (!response.ok || !result?.redirect) {
        setError(result?.code === "invalid_code" ? copy.errors.code : result?.code === "rate_limited" ? copy.errors.rateLimited : copy.errors.verify);
        return;
      }
      // The server chooses between onboarding and the invited company.
      window.location.assign(result.redirect);
    } catch {
      setError(copy.errors.connection);
    } finally {
      setSubmitting(false);
    }
  }

  async function resendCode() {
    if (submitting || resending) return;
    if (cooldown > 0) return setError(copy.errors.resendWait);
    setResending(true);
    setError(null);
    try {
      const response = await registrationRequest("send");
      if (!response.ok) {
        setError(await registrationSendError(response));
        return;
      }
      setCode("");
      setCooldown(60);
      setResendAt(Date.now() + 60_000);
    } catch {
      setError(copy.errors.connection);
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell
      art="laptop"
      layout="registration"
      brand={brand}
      claim={copy.claim}
      claimSub={customEntry ? copy.claimSubCustomEntry : copy.claimSub}
    >
      <span className={styles.eyebrow}>{copy.eyebrow}</span>
      <h1 className={styles.title}>{customEntry ? copy.titleCustomEntry : copy.title}</h1>
      <p className={styles.sub}>{customEntry ? copy.subCustomEntry : copy.sub}</p>
      {!customEntry && !sent && <p className={styles.note}>{copy.invitationHint}</p>}
      {sent ? (
        <form onSubmit={verifyCode} className={styles.form}>
          <div className={styles.sent} role="status">
            <Mail width={22} height={22} />
            <div>
              <strong>{copy.sentTitle}</strong>
              <p>{copy.sentBefore}<b>{email}</b>{copy.sentAfter}</p>
              {customEntry ? null : <p>{copy.sentSignup}</p>}
            </div>
          </div>
          <OtpInput value={code} onChange={setCode} length={CODE_LENGTH} ariaLabel={copy.codeLabel} disabled={submitting || resending} autoFocus />
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button type="submit" className={styles.primary} disabled={submitting || resending || code.length !== CODE_LENGTH}>{submitting ? copy.verifying : copy.verifyCode} <ArrowRight /></button>
          <button type="button" className={styles.textButton} disabled={submitting || resending || cooldown > 0} onClick={resendCode}>{resending ? copy.resending : cooldown > 0 ? t.auth.mfa.resendIn(cooldown) : copy.resendCode}</button>
          <button type="button" className={styles.textButton} disabled={submitting || resending} onClick={() => { setSent(false); setCode(""); setError(null); }}>{copy.changeDetails}</button>
        </form>
      ) : (
        <form onSubmit={register} className={styles.form}>
          <div className={styles.pair}>
            <label className={styles.field}>
              <span>{common.fullName}</span>
              <span className={styles.control}><User /><input autoComplete="name" required placeholder={common.namePlaceholder} value={fullName} onChange={(event) => setFullName(event.target.value)} /></span>
            </label>
            <label className={styles.field}>
              <span>{common.companyEmail}</span>
              <span className={styles.control}><Mail /><input type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" inputMode="email" autoComplete="email" required placeholder={customEntry ? common.emailPlaceholderAt(CUSTOM_ENTRY_EMAIL_DOMAIN) : common.emailPlaceholder} value={email} onChange={(event) => setEmail(event.target.value)} /></span>
            </label>
          </div>
          <div className={styles.pair}>
            <label className={styles.field}>
              <span>{common.password}</span>
              <span className={styles.control}><Lock /><PasswordInput autoComplete="new-password" enterKeyHint="next" required minLength={12} placeholder={common.choosePassword} value={password} onChange={(event) => setPassword(event.target.value)} /></span>
            </label>
            <label className={styles.field}>
              <span>{common.passwordAgain}</span>
              <span className={styles.control}><Lock /><PasswordInput autoComplete="new-password" enterKeyHint="done" required minLength={12} placeholder={common.repeatPassword} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></span>
            </label>
          </div>
          <small className={styles.note} style={{ marginTop: -6 }}>{common.passwordHint}</small>
          {customEntry ? null : (
            <label className={styles.check}>
              <input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} />
              <span>{common.terms.before}<Link href="/podminky" target="_blank">{common.terms.terms}</Link>{common.terms.between}<Link href="/ochrana-osobnich-udaju" target="_blank">{common.terms.privacy}</Link>{common.terms.after}</span>
            </label>
          )}
          {error === "custom_entry" ? (
            <p className={styles.error}>{copy.customEntryEntry}<Link href={CUSTOM_ENTRY_REGISTRATION_PATH}>{`splatno.cz${CUSTOM_ENTRY_REGISTRATION_PATH}`}</Link>.</p>
          ) : error ? <p className={styles.error}>{error}</p> : null}
          <button type="submit" className={styles.primary} disabled={submitting}>
            {submitting ? copy.submitting : copy.submit} <ArrowRight />
          </button>
        </form>
      )}
      <p className={styles.foot}>{copy.haveAccount}<Link href="/login">{common.login}</Link></p>
    </AuthShell>
  );
}
