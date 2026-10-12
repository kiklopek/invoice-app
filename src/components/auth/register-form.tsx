"use client";

import { PasswordInput } from "@/components/auth/password-input";
import Link from "next/link";
import { useState } from "react";
import { AuthShell, authStyles as styles, type AuthBrand } from "@/components/auth/auth-shell";
import { useI18n } from "@/i18n/client";
import { ArrowRight, Lock, Mail, User } from "@/components/landing/landing-icons";
import { CUSTOM_ENTRY_EMAIL_DOMAIN, emailMatchesDomain, isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { withEntry } from "@/lib/login-entry";
import { CUSTOM_ENTRY_REGISTRATION_PATH, isCustomEntryBrand } from "@/lib/tenant-entries";
import { passwordRule } from "@/lib/password-policy";
import { hasSupabaseBrowserConfig, preloadSupabaseBrowserClient } from "@/lib/supabase-config";

// Registrace. Dva oddělené vstupy:
// - "splatno" (/register): kdo nemá pozvánku, zakládá firemní účet a po
//   potvrzení e-mailu a 2FA projde onboardingem; kdo pozvánku má, se po
//   potvrzení e-mailu připojí ke své firmě. S R. Hlavica nesouvisí.
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const copy = t.auth.register;
  const common = t.auth.common;

  async function register(event: React.FormEvent) {
    event.preventDefault();
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
    const accessResponse = await fetch("/api/auth/registration-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, entry: brand }),
    });
    if (!accessResponse.ok) {
      setError(copy.errors.accessCheck);
      setSubmitting(false);
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
      setSubmitting(false);
      return;
    }

    const { createClient } = await import("@/lib/supabase-browser");
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${withEntry("/auth/callback?next=/mfa", brand)}`,
        data: customEntry
          ? { full_name: fullName.trim() }
          : { full_name: fullName.trim(), terms_accepted_at: new Date().toISOString() },
      },
    });
    if (signUpError) {
      setError(copy.errors.signUp);
      setSubmitting(false);
      return;
    }
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setError(copy.errors.member);
      setSubmitting(false);
      return;
    }
    if (data.session) {
      const accessResponse = await fetch("/api/auth/access", { method: "POST" });
      if (!accessResponse.ok) {
        await supabase.auth.signOut();
        setError(copy.errors.verify);
        setSubmitting(false);
        return;
      }
      const access = await accessResponse.json().catch(() => null) as { mfa_bypassed?: unknown } | null;
      const sessionPreference = await fetch("/api/auth/session-preference", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remember: false }),
      });
      if (!sessionPreference.ok) {
        await supabase.auth.signOut({ scope: "local" });
        setError(copy.errors.sessionSave);
        setSubmitting(false);
        return;
      }
      window.location.assign(access?.mfa_bypassed === true ? "/dashboard" : withEntry("/mfa", brand));
      return;
    }
    setEmail(normalizedEmail);
    setSent(true);
    setSubmitting(false);
  }

  return (
    <AuthShell
      art="laptop"
      brand={brand}
      claim={copy.claim}
      claimSub={customEntry ? copy.claimSubCustomEntry : copy.claimSub}
    >
      <span className={styles.eyebrow}>{copy.eyebrow}</span>
      <h1 className={styles.title}>{customEntry ? copy.titleCustomEntry : copy.title}</h1>
      <p className={styles.sub}>{customEntry ? copy.subCustomEntry : copy.sub}</p>
      {sent ? (
        <div className={styles.sent}>
          <Mail width={22} height={22} />
          <div>
            <strong>{copy.sentTitle}</strong>
            <p>{copy.sentBefore}<b>{email}</b>{copy.sentAfter}</p>
            {customEntry ? null : <p>{copy.sentSignup}</p>}
          </div>
        </div>
      ) : (
        <form onSubmit={register} onFocus={preloadSupabaseBrowserClient} className={styles.form}>
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
