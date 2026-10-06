"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";
import { AuthShell, authStyles as styles } from "@/components/auth/auth-shell";
import { ArrowRight, Lock, Mail } from "@/components/landing/landing-icons";
import { ALLOWED_EMAIL_DOMAIN, isAllowedCorporateEmail, isCorporateEmailRequired, normalizeEmail } from "@/lib/auth-policy";
import { safeReturnPath } from "@/lib/safe-return-path";

export default function LoginPage() {
  const corporateEmailRequired = isCorporateEmailRequired();
  const supabaseConfigured = hasSupabaseBrowserConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginFailure, setLoginFailure] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason === "access") setError("Tento firemní účet nemá aktivní přístup. Obraťte se na administrátora.");
    else if (reason === "domain") setError(corporateEmailRequired ? `Přihlášení je povoleno pouze pro e-maily @${ALLOWED_EMAIL_DOMAIN}.` : "Zadejte platnou e-mailovou adresu.");
    else if (reason === "callback") setError("Ověřovací odkaz je neplatný nebo už vypršel. Pošlete si nový.");
    else if (reason === "password-updated") setPasswordUpdated(true);
    else if (!supabaseConfigured) setError("Localhost není připojený ke skutečnému Supabase projektu. Doplňte povinné proměnné v .env.local a restartujte server.");
  }, [corporateEmailRequired, supabaseConfigured]);

  function validEmail() {
    const normalized = normalizeEmail(email);
    if (!isAllowedCorporateEmail(normalized)) {
      setError(corporateEmailRequired ? `Použijte firemní e-mail ve tvaru jmeno@${ALLOWED_EMAIL_DOMAIN}.` : "Zadejte platnou e-mailovou adresu.");
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
      const result = await response.json().catch(() => null) as { mfa_bypassed?: unknown } | null;
      return { ok: true as const, mfaBypassed: result?.mfa_bypassed === true };
    }
    const result = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null;
    const supabase = createClient();
    await supabase.auth.signOut();
    return {
      ok: false as const,
      message: response.status === 403 && result?.code === "access_denied"
        ? "Tento účet nemá aktivní přístup do firemní aplikace. Obraťte se na administrátora."
        : "Přihlášení se nepodařilo ověřit. Obnovte stránku a zkuste to znovu.",
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
      setError("Přihlášení není nakonfigurované. Doplňte Supabase proměnné prostředí.");
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
      setError("Přihlášení nevytvořilo platnou relaci. Obnovte stránku a zkuste to znovu.");
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
      setError("Přihlášení se nepodařilo bezpečně uložit. Zkuste to znovu.");
      setSubmitting(false);
      return;
    }
    // Kam uzivatel mířil, nez ho vyhodila vyprsena session. Proxy i
    // api-client returnTo posilaji; drive ho tahle stranka ignorovala
    // a kazdy skoncil na /dashboard. Hodnota jde z URL, takze prochazi
    // safeReturnPath -- jinak by to byl otevreny redirect.
    const returnTo = safeReturnPath(new URLSearchParams(window.location.search).get("returnTo"));
    // Pri MFA se cil nese dal, aby se neztratil behem overeni.
    window.location.assign(
      access.mfaBypassed ? returnTo : `/mfa?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  return (
    <AuthShell art="wave" claim={<>Méně hledání.<br />Více hotových faktur.</>}>
      <span className={styles.eyebrow}>Firemní aplikace</span>
      <h1 className={styles.title}>Přihlášení</h1>
      <p className={styles.sub}>Vítejte zpět. Pokračujte ve správě faktur a pohledávek.</p>
      <form onSubmit={signIn} className={styles.form}>
        {passwordUpdated && <p className={styles.success}>Heslo bylo změněno. Nyní se můžete přihlásit.</p>}
        <label className={styles.field}>
          <span>Firemní e-mail</span>
          <span className={styles.control}>
            <Mail />
            <input type="email" inputMode="email" autoComplete="email" required placeholder={`jmeno@${ALLOWED_EMAIL_DOMAIN}`} value={email} onChange={(event) => setEmail(event.target.value)} />
          </span>
        </label>
        <label className={styles.field}>
          <span>Heslo</span>
          <span className={styles.control}>
            <Lock />
            <input type="password" autoComplete="current-password" required placeholder="Zadejte své heslo" value={password} onChange={(event) => setPassword(event.target.value)} />
          </span>
        </label>
        <div className={styles.row}>
          <label className={styles.check}><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Zapamatovat si mě</span></label>
          <span className={styles.link}><Link href="/forgot-password">Obnovit heslo</Link></span>
        </div>
        {loginFailure && <p className={styles.error}>E-mail nebo heslo není správné. Zkuste to znovu nebo klikněte na <Link href="/forgot-password">„Obnovit heslo“</Link>.</p>}
        {error && <p className={styles.error}>{error}</p>}
        <button type="submit" className={styles.primary} disabled={submitting || !supabaseConfigured}>
          {submitting ? "Přihlašuji…" : "Přihlásit se"} <ArrowRight />
        </button>
      </form>
      <p className={styles.foot}>Ještě nemáte účet?<Link href="/register">Vytvořit účet</Link></p>
      <p className={styles.note}>Přihlášení je chráněno heslem a jednorázovým kódem zaslaným na firemní e-mail.</p>
    </AuthShell>
  );
}
