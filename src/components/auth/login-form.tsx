"use client";

import { PasswordInput } from "@/components/auth/password-input";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";
import { AuthShell, authStyles as styles, type AuthBrand } from "@/components/auth/auth-shell";
import { useI18n } from "@/i18n/client";
import { ArrowRight, Lock, Mail } from "@/components/landing/landing-icons";
import { HLAVICA_EMAIL_DOMAIN, isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { withEntry } from "@/lib/login-entry";
import { HLAVICA_ENTRY } from "@/lib/tenant-entries";
import { safeReturnPath } from "@/lib/safe-return-path";

// Přihlášení (P8). /login (obecný vzhled Splatna) i /hlavica (vzhled
// R. Hlavica) jsou totéž přihlášení; liší se jen vzhledem a tím, kam se
// člověk vrátí po odhlášení.
export function LoginForm({ brand }: { brand: AuthBrand }) {
  const supabaseConfigured = hasSupabaseBrowserConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginFailure, setLoginFailure] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const { t } = useI18n();
  const copy = t.auth.login;
  const common = t.auth.common;

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason === "access") setError(copy.errors.access);
    else if (reason === "domain") setError(common.invalidEmail);
    else if (reason === "callback") setError(copy.errors.callback);
    else if (reason === "password-updated") setPasswordUpdated(true);
    else if (!supabaseConfigured) setError(copy.errors.notConnected);
  }, [supabaseConfigured, copy, common]);

  function validEmail() {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setError(common.invalidEmail);
      return null;
    }
    return normalized;
  }

  async function verifyApplicationAccess(accessToken: string) {
    const response = await fetch("/api/auth/access", {
      method: "POST",
      credentials: "same-origin",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) {
      const result = await response.json().catch(() => null) as { mfa_bypassed?: unknown; needsOnboarding?: unknown } | null;
      return { ok: true as const, mfaBypassed: result?.mfa_bypassed === true, needsOnboarding: result?.needsOnboarding === true };
    }
    const result = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null;
    const supabase = createClient();
    await supabase.auth.signOut();
    return {
      ok: false as const,
      message: response.status === 403 && result?.code === "access_denied"
        ? copy.errors.accessDenied
        : copy.errors.accessFailed,
    };
  }

  async function saveSessionPreference(accessToken: string) {
    const response = await fetch("/api/auth/session-preference", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ remember }),
    });
    return response.ok;
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoginFailure(false);
    const normalizedEmail = validEmail();
    if (!normalizedEmail) return;
    if (!hasSupabaseBrowserConfig()) {
      setError(copy.errors.notConfigured);
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (signInError) {
      setLoginFailure(true);
      setSubmitting(false);
      return;
    }
    const accessToken = signInData.session?.access_token;
    if (!accessToken) {
      await supabase.auth.signOut({ scope: "local" });
      setError(copy.errors.noSession);
      setSubmitting(false);
      return;
    }
    const access = await verifyApplicationAccess(accessToken);
    if (!access.ok) {
      setError(access.message);
      setSubmitting(false);
      return;
    }
    if (!await saveSessionPreference(accessToken)) {
      await supabase.auth.signOut({ scope: "local" });
      setError(copy.errors.sessionSave);
      setSubmitting(false);
      return;
    }
    // Kam uzivatel mířil, nez ho vyhodila vyprsena session. Proxy i
    // api-client returnTo posilaji; drive ho tahle stranka ignorovala
    // a kazdy skoncil na /dashboard. Hodnota jde z URL, takze prochazi
    // safeReturnPath -- jinak by to byl otevreny redirect.
    // Zakladatel bez firmy pokračuje po 2FA onboardingem (P12).
    const returnTo = access.needsOnboarding
      ? "/onboarding"
      : safeReturnPath(new URLSearchParams(window.location.search).get("returnTo"));
    // Pri MFA se cil nese dal, aby se neztratil behem overeni.
    window.location.assign(
      access.mfaBypassed ? returnTo : withEntry(`/mfa?returnTo=${encodeURIComponent(returnTo)}`, brand),
    );
  }

  return (
    <AuthShell art="wave" brand={brand} claim={<>{copy.claim1}<br />{copy.claim2}</>}>
      {brand === "hlavica" ? <span className={styles.eyebrow}>{HLAVICA_ENTRY.name}</span> : null}
      <h1 className={styles.title}>{copy.title}</h1>
      <p className={styles.sub}>{copy.sub}</p>
      <form onSubmit={signIn} className={styles.form}>
        {passwordUpdated && <p className={styles.success}>{copy.passwordUpdated}</p>}
        <label className={styles.field}>
          <span>{common.companyEmail}</span>
          <span className={styles.control}>
            <Mail />
            <input type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" inputMode="email" autoComplete="email" required placeholder={brand === "hlavica" ? common.emailPlaceholderAt(HLAVICA_EMAIL_DOMAIN) : common.emailPlaceholder} value={email} onChange={(event) => setEmail(event.target.value)} />
          </span>
        </label>
        <label className={styles.field}>
          <span>{common.password}</span>
          <span className={styles.control}>
            <Lock />
            <PasswordInput autoComplete="current-password" enterKeyHint="go" required placeholder={copy.passwordPlaceholder} value={password} onChange={(event) => setPassword(event.target.value)} />
          </span>
        </label>
        <div className={styles.row}>
          <label className={styles.check}><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>{copy.remember}</span></label>
          <span className={styles.link}><Link href={withEntry("/forgot-password", brand)}>{copy.forgot}</Link></span>
        </div>
        {loginFailure && <p className={styles.error}>{copy.failureBefore}<Link href={withEntry("/forgot-password", brand)}>{copy.failureLink}</Link>{copy.failureAfter}</p>}
        {error && <p className={styles.error}>{error}</p>}
        <button type="submit" className={styles.primary} disabled={submitting || !supabaseConfigured}>
          {submitting ? copy.submitting : copy.submit} <ArrowRight />
        </button>
      </form>
      {brand === "hlavica"
        ? <p className={styles.foot}>{copy.noAccount}<Link href={`${HLAVICA_ENTRY.path}/registrace`}>{copy.createAccount}</Link></p>
        : <p className={styles.foot}>{copy.noAccount}<Link href="/register">{copy.createCompanyAccount}</Link></p>}
      <p className={styles.note}>{copy.note}</p>
    </AuthShell>
  );
}
