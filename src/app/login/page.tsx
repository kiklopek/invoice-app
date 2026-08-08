"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import { CompanyLogo } from "@/components/company-logo";
import { isAllowedCorporateEmail, isCorporateEmailRequired, normalizeEmail } from "@/lib/auth-policy";

export default function LoginPage() {
  const corporateEmailRequired = isCorporateEmailRequired();
  const localDemoMode = !corporateEmailRequired && !hasSupabaseBrowserConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason === "access") setError("Tento firemní účet nemá aktivní přístup. Obraťte se na administrátora.");
    else if (reason === "domain") setError(corporateEmailRequired ? "Přihlášení je povoleno pouze pro e-maily @hlavica.cz." : "Zadejte platnou e-mailovou adresu.");
    else if (reason === "callback") setError("Ověřovací odkaz je neplatný nebo už vypršel. Pošlete si nový.");
    else if (reason === "password-updated") setPasswordUpdated(true);
  }, [corporateEmailRequired]);

  function validEmail() {
    const normalized = normalizeEmail(email);
    if (!isAllowedCorporateEmail(normalized)) {
      setError(corporateEmailRequired ? "Použijte firemní e-mail ve tvaru jmeno@hlavica.cz." : "Zadejte platnou e-mailovou adresu.");
      return null;
    }
    return normalized;
  }

  async function verifyApplicationAccess() {
    const response = await fetch("/api/auth/access", { method: "POST" });
    if (response.ok) return true;
    const supabase = createClient();
    await supabase.auth.signOut();
    return false;
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const normalizedEmail = validEmail();
    if (!normalizedEmail) return;
    if (!hasSupabaseBrowserConfig()) {
      setError("Přihlášení není nakonfigurované. Doplňte Supabase proměnné prostředí.");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (signInError) {
      setError("E-mail nebo heslo není správné. Případně si nastavte nové heslo.");
      setSubmitting(false);
      return;
    }
    if (!await verifyApplicationAccess()) {
      setError("Tento účet není pozvaný do firemní aplikace. Obraťte se na administrátora.");
      setSubmitting(false);
      return;
    }
    window.location.assign("/mfa");
  }

  async function sendMagicLink() {
    setError(null);
    const normalizedEmail = validEmail();
    if (!normalizedEmail) return;
    if (!hasSupabaseBrowserConfig()) {
      setError("Přihlášení není nakonfigurované. Doplňte Supabase proměnné prostředí.");
      return;
    }
    setSendingLink(true);
    const supabase = createClient();
    const { error: linkError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/mfa`, shouldCreateUser: false },
    });
    setSendingLink(false);
    if (linkError) setError("Přihlašovací odkaz se nepodařilo odeslat. Zkuste to znovu.");
    else {
      setEmail(normalizedEmail);
      setMagicSent(true);
    }
  }

  return (
    <main className="login-page auth-page">
      <section className="login-card auth-card">
        <header className="login-header">
          <div className="login-brand"><CompanyLogo className="login-company-logo" /></div>
          <div className="login-intro"><span>FIREMNÍ APLIKACE</span><h1>Přihlášení</h1><p>Správa faktur a pohledávek R. Hlavica.</p></div>
        </header>

        <div className="login-body">
          {localDemoMode ? (
            <div className="login-sent"><Icon name="check"/><div><strong>Lokální demo režim</strong><p>Supabase není nastavený. Pokračujte přímo do aplikace s testovacími daty.</p><button type="button" className="btn primary" onClick={() => window.location.assign("/dashboard")}>Otevřít aplikaci</button></div></div>
          ) : magicSent ? (
            <div className="login-sent"><Icon name="check"/><div><strong>Odkaz je na cestě</strong><p>Poslali jsme jej na <b>{email}</b>. Po otevření budete pokračovat přes zabezpečení 2FA.</p><button type="button" className="auth-text-button" onClick={() => setMagicSent(false)}>Zpět na přihlášení</button></div></div>
          ) : (
            <>
              {passwordUpdated && <p className="form-success">Heslo bylo změněno. Nyní se můžete přihlásit.</p>}
              <form onSubmit={signIn} className="auth-form">
                <label><span>Firemní e-mail</span><input type="email" inputMode="email" autoComplete="email" required placeholder="jmeno@hlavica.cz" value={email} onChange={(event) => setEmail(event.target.value)}/></label>
                <label><span>Heslo</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)}/></label>
                <div className="auth-field-link"><Link href="/forgot-password">Zapomenuté heslo?</Link></div>
                <button type="submit" className="btn primary" disabled={submitting || sendingLink}><Icon name="check"/>{submitting ? "Přihlašuji…" : "Přihlásit se"}</button>
                {error && <p className="form-error">{error}</p>}
              </form>
              <div className="auth-divider"><span>nebo</span></div>
              <button type="button" className="btn secondary auth-wide-button" disabled={submitting || sendingLink} onClick={sendMagicLink}><Icon name="mail"/>{sendingLink ? "Odesílám…" : "Poslat přihlašovací odkaz"}</button>
              <p className="auth-switch">Nemáte ještě účet? <Link href="/register">Vytvořit účet</Link></p>
            </>
          )}
        </div>
        <small className="login-security">Přístup je určen pozvaným uživatelům a chráněn povinným dvoufázovým ověřením.</small>
      </section>
    </main>
  );
}
