"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";
import { AuthShell, authStyles as styles, type AuthBrand } from "@/components/auth/auth-shell";
import { ArrowRight, Lock, Mail } from "@/components/landing/landing-icons";
import { HLAVICA_EMAIL_DOMAIN, isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { rememberLoginEntry } from "@/lib/login-entry";
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

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason === "access") setError("Tento firemní účet nemá aktivní přístup. Obraťte se na administrátora.");
    else if (reason === "domain") setError("Zadejte platnou e-mailovou adresu.");
    else if (reason === "callback") setError("Ověřovací odkaz je neplatný nebo už vypršel. Pošlete si nový.");
    else if (reason === "password-updated") setPasswordUpdated(true);
    else if (!supabaseConfigured) setError("Localhost není připojený ke skutečnému Supabase projektu. Doplňte povinné proměnné v .env.local a restartujte server.");
  }, [supabaseConfigured]);

  function validEmail() {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setError("Zadejte platnou e-mailovou adresu.");
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
        ? "Tento účet nemá aktivní přístup do aplikace. Obraťte se na administrátora své firmy."
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
    // Zakladatel bez firmy pokračuje po 2FA onboardingem (P12).
    const returnTo = access.needsOnboarding
      ? "/onboarding"
      : safeReturnPath(new URLSearchParams(window.location.search).get("returnTo"));
    rememberLoginEntry(brand === "hlavica" ? "/hlavica" : "/login");
    // Pri MFA se cil nese dal, aby se neztratil behem overeni.
    window.location.assign(
      access.mfaBypassed ? returnTo : `/mfa?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  return (
    <AuthShell art="wave" brand={brand} claim={<>Méně hledání.<br />Více hotových faktur.</>}>
      <span className={styles.eyebrow}>{brand === "hlavica" ? HLAVICA_ENTRY.name : "Firemní aplikace"}</span>
      <h1 className={styles.title}>Přihlášení</h1>
      <p className={styles.sub}>Vítejte zpět. Pokračujte ve správě faktur a pohledávek.</p>
      <form onSubmit={signIn} className={styles.form}>
        {passwordUpdated && <p className={styles.success}>Heslo bylo změněno. Nyní se můžete přihlásit.</p>}
        <label className={styles.field}>
          <span>Firemní e-mail</span>
          <span className={styles.control}>
            <Mail />
            <input type="email" inputMode="email" autoComplete="email" required placeholder={brand === "hlavica" ? `jmeno@${HLAVICA_EMAIL_DOMAIN}` : "jmeno@firma.cz"} value={email} onChange={(event) => setEmail(event.target.value)} />
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
      {brand === "hlavica"
        ? <p className={styles.foot}>Nemáte přístup?<span className={styles.footText}>Požádejte administrátora o pozvánku.</span></p>
        : <p className={styles.foot}>Ještě nemáte účet?<Link href="/register">Založit firemní účet</Link></p>}
      <p className={styles.note}>Přihlášení je chráněno heslem a jednorázovým kódem zaslaným na váš e-mail.</p>
    </AuthShell>
  );
}
