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
  const [error, setError] = useState<string | null>(null);
  const [loginFailure, setLoginFailure] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
    setLoginFailure(false);
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
      setLoginFailure(true);
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
          ) : (
            <>
              {passwordUpdated && <p className="form-success">Heslo bylo změněno. Nyní se můžete přihlásit.</p>}
              <form onSubmit={signIn} className="auth-form">
                <label><span>Firemní e-mail</span><input type="email" inputMode="email" autoComplete="email" required placeholder="jmeno@hlavica.cz" value={email} onChange={(event) => setEmail(event.target.value)}/></label>
                <label><span>Heslo</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)}/></label>
                <div className="auth-field-link"><Link href="/forgot-password">Obnovit heslo</Link></div>
                <button type="submit" className="btn primary" disabled={submitting}><Icon name="check"/>{submitting ? "Přihlašuji…" : "Přihlásit se"}</button>
                {loginFailure && <p className="form-error">E-mail nebo heslo není správné. Zkuste to znovu nebo klikněte na <Link href="/forgot-password">„Obnovit heslo“</Link>.</p>}
                {error && <p className="form-error">{error}</p>}
              </form>
              <p className="auth-switch">Nemáte ještě účet? <Link href="/register">Vytvořit účet</Link></p>
            </>
          )}
        </div>
        <small className="login-security">Přihlášení je chráněno heslem a jednorázovým kódem zaslaným na firemní e-mail.</small>
      </section>
    </main>
  );
}
