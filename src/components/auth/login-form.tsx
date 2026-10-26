"use client";

import {
  LoginProgress,
  type LoginPhase,
  type LoginIssue,
} from "./login-progress";
import { loginRequestIssue, loginTransportIssue, unexpectedLoginIssue } from "./login-issue";
import { PasswordInput } from "@/components/auth/password-input";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  hasSupabaseBrowserConfig,
  preloadSupabaseBrowserClient,
} from "@/lib/supabase-config";
import {
  AuthShell,
  authStyles as styles,
  type AuthBrand,
} from "@/components/auth/auth-shell";
import { useI18n } from "@/i18n/client";
import { ArrowRight, Lock, Mail } from "@/components/landing/landing-icons";
import {
  CUSTOM_ENTRY_EMAIL_DOMAIN,
  isValidEmail,
  normalizeEmail,
} from "@/lib/auth-policy";
import { withEntry } from "@/lib/login-entry";
import {
  CUSTOM_ENTRY,
  CUSTOM_ENTRY_REGISTRATION_PATH,
  isCustomEntryBrand,
} from "@/lib/tenant-entries";
import { safeReturnPath } from "@/lib/safe-return-path";
import { measureLoginOperation, markLoginRedirect } from "@/lib/login-timing";

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
  const [phase, setPhase] = useState<LoginPhase>("credentials");
  const [issue, setIssue] = useState<LoginIssue | null>(null);
  const [slow, setSlow] = useState(false);
  const inFlight = useRef(false);
  const retryToken = useRef<string | null>(null);
  const completedAccess = useRef<{ ok: true; mfaBypassed: boolean; needsOnboarding: boolean } | null>(null);
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

  useEffect(() => {
    if (!submitting) return;
    setSlow(false);
    // Informace o dlouhém čekání neposouvá fáze ani nepřerušuje Supabase Auth.
    const timer = window.setTimeout(() => setSlow(true), 15000);
    return () => window.clearTimeout(timer);
  }, [submitting, phase]);

  function validEmail() {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setError(common.invalidEmail);
      return null;
    }
    return normalized;
  }

  async function verifyApplicationAccess(accessToken: string) {
    if (completedAccess.current) return completedAccess.current;
    try {
      const response = await fetch("/api/auth/access", {
        signal: AbortSignal.timeout(30000),
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ remember }),
      });
      if (response.ok) {
        const result = (await response.json().catch(() => null)) as {
          mfa_bypassed?: unknown;
          needsOnboarding?: unknown;
        } | null;
        if (
          typeof result?.mfa_bypassed !== "boolean" ||
          typeof result?.needsOnboarding !== "boolean"
        ) {
          return { ok: false as const, issue: loginRequestIssue(422, "access") };
        }
        return {
          ok: true as const,
          mfaBypassed: result?.mfa_bypassed === true,
          needsOnboarding: result?.needsOnboarding === true,
        };
      }
      return {
        ok: false as const,
        resetSession: response.status === 401 || response.status === 403,
        issue: loginRequestIssue(response.status, "access"),
      };
    } catch (error) {
      return { ok: false as const, issue: loginTransportIssue(error) };
    }
  }

  async function signIn(event?: React.FormEvent) {
    event?.preventDefault();
    if (inFlight.current) return;
    setError(null);
    setLoginFailure(false);
    const normalizedEmail = validEmail();
    if (!normalizedEmail) return;
    if (!hasSupabaseBrowserConfig()) {
      setError(copy.errors.notConfigured);
      return;
    }
    inFlight.current = true;
    completedAccess.current = null;
    retryToken.current = null;
    setPhase("credentials");
    setSubmitting(true);
    let authenticated = false;
    try {
      const { createClient } = await import("@/lib/supabase-browser");
      const supabase = createClient();
      const { data: signInData, error: signInError } =
        await measureLoginOperation("credentials", () => supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        }));
      if (signInError) {
        if (
          signInError.status === 0 ||
          (signInError.status ?? 0) >= 500 ||
          signInError.name === "AuthRetryableFetchError"
        ) {
          setError(
            signInError.status && signInError.status >= 500
              ? "Server nemohl dokončit přihlášení. Zkuste to znovu."
              : "Momentálně se nemůžeme spojit se serverem.",
          );
        } else {
          setLoginFailure(true);
        }
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
      authenticated = true;
      retryToken.current = accessToken;
      await initializeEnvironment(accessToken);
    } catch (error) {
      if (authenticated) {
        setIssue(unexpectedLoginIssue());
      } else {
        // Chyby hesla a ověřování zůstávají ve stávajícím formuláři.
        setError(error instanceof TypeError
          ? "Momentálně se nemůžeme spojit se serverem."
          : "Přihlášení se nepodařilo dokončit. Zkuste to prosím znovu.");
      }
      setSubmitting(false);
    } finally {
      inFlight.current = false;
    }
  }

  async function initializeEnvironment(accessToken: string) {
    setPhase("environment");
    const access = await measureLoginOperation("environment", () => verifyApplicationAccess(accessToken));
    if (!access.ok && "resetSession" in access && access.resetSession) {
      retryToken.current = null;
      const { createClient } = await import("@/lib/supabase-browser");
      await createClient().auth.signOut({ scope: "local" });
    }
    if (access.ok) completedAccess.current = access;
    if (!access.ok) {
      setIssue({ ...access.issue, retryable: access.issue.retryable && retryToken.current !== null });
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
      : safeReturnPath(
          new URLSearchParams(window.location.search).get("returnTo"),
        );
    // Pri MFA se cil nese dal, aby se neztratil behem overeni.
    setPhase("redirect");
    markLoginRedirect();
    window.location.assign(
      access.mfaBypassed
        ? returnTo
        : withEntry(`/mfa?returnTo=${encodeURIComponent(returnTo)}`, brand),
    );
  }

  async function retryInitialization() {
    if (inFlight.current || !retryToken.current || !issue?.retryable) return;
    inFlight.current = true;
    setIssue(null);
    setSubmitting(true);
    try {
      await initializeEnvironment(retryToken.current);
    } catch {
      setIssue(unexpectedLoginIssue());
      setSubmitting(false);
    } finally {
      inFlight.current = false;
    }
  }

  if (submitting || issue) {
    return (
      <LoginProgress
        phase={phase}
        issue={issue}
        slow={slow}
        onRetry={() => void retryInitialization()}
        onBack={() => window.location.reload()}
      />
    );
  }

  return (
    <AuthShell art="wave" brand={brand} claim={<>{copy.claim1}<br />{copy.claim2}</>}>
      {isCustomEntryBrand(brand) ? <span className={styles.eyebrow}>{CUSTOM_ENTRY.name}</span> : null}
      <h1 className={styles.title}>{copy.title}</h1>
      <p className={styles.sub}>{copy.sub}</p>
      <form onSubmit={signIn} onFocus={preloadSupabaseBrowserClient} className={styles.form}>
        {passwordUpdated && <p className={styles.success}>{copy.passwordUpdated}</p>}
        <label className={styles.field}>
          <span>{common.companyEmail}</span>
          <span className={styles.control}>
            <Mail />
            <input type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" inputMode="email" autoComplete="email" required placeholder={isCustomEntryBrand(brand) ? common.emailPlaceholderAt(CUSTOM_ENTRY_EMAIL_DOMAIN) : common.emailPlaceholder} value={email} onChange={(event) => setEmail(event.target.value)} />
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
      {isCustomEntryBrand(brand)
        ? <p className={styles.foot}>{copy.noAccount}<Link href={CUSTOM_ENTRY_REGISTRATION_PATH}>{copy.createAccount}</Link></p>
        : <p className={styles.foot}>{copy.noAccount}<Link href="/register">{copy.createCompanyAccount}</Link></p>}
      <p className={styles.note}>{copy.note}</p>
    </AuthShell>
  );
}
