"use client";

import Link from "next/link";
import { useState } from "react";
import { CompanyLogo } from "@/components/company-logo";
import { Icon } from "@/components/icons";
import { isAllowedCorporateEmail, isCorporateEmailRequired, normalizeEmail } from "@/lib/auth-policy";
import { passwordProblem } from "@/lib/password-policy";
import { createClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";

export default function RegisterPage() {
  const corporateEmailRequired = isCorporateEmailRequired();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function register(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const normalizedEmail = normalizeEmail(email);
    if (fullName.trim().length < 3) return setError("Zadejte celé jméno uživatele.");
    if (!isAllowedCorporateEmail(normalizedEmail)) return setError(corporateEmailRequired ? "Registrace je povolena pouze pro e-maily @hlavica.cz." : "Zadejte platnou e-mailovou adresu.");
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirmation) return setError("Zadaná hesla se neshodují.");
    if (!hasSupabaseBrowserConfig()) return setError("Registrace není nakonfigurovaná. Doplňte Supabase proměnné prostředí.");

    setSubmitting(true);
    const accessResponse = await fetch("/api/auth/registration-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail }),
    });
    if (!accessResponse.ok) {
      setError("Ověření firemního přístupu se nepodařilo. Zkuste to prosím znovu.");
      setSubmitting(false);
      return;
    }
    const access = (await accessResponse.json()) as { allowed?: boolean };
    if (!access.allowed) {
      setError("Pro tento e-mail zatím nelze vytvořit účet, protože nebyl administrátorem firmy přidán do systému. Kontaktujte prosím jednatele firmy.");
      setSubmitting(false);
      return;
    }

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/mfa`,
        data: { full_name: fullName.trim() },
      },
    });
    if (signUpError) {
      setError("Účet se nepodařilo vytvořit. Zkontrolujte údaje nebo kontaktujte administrátora.");
      setSubmitting(false);
      return;
    }
    if (data.session) {
      const access = await fetch("/api/auth/access", { method: "POST" });
      if (!access.ok) {
        await supabase.auth.signOut();
        setError("Pro tento e-mail není připravená firemní pozvánka. Obraťte se na administrátora.");
        setSubmitting(false);
        return;
      }
      window.location.assign("/mfa");
      return;
    }
    setEmail(normalizedEmail);
    setSent(true);
    setSubmitting(false);
  }

  return (
    <main className="login-page auth-page">
      <section className="login-card auth-card">
        <header className="login-header">
          <div className="login-brand"><CompanyLogo className="login-company-logo" /></div>
          <div className="login-intro"><span>NOVÝ ÚČET</span><h1>Vytvoření účtu</h1><p>Registrace pro uživatele pozvané do firemní aplikace.</p></div>
        </header>
        <div className="login-body">
          {sent ? (
            <div className="login-sent"><Icon name="mail"/><div><strong>Dokončete přístup k účtu</strong><p>Pokud jde o úplně nový účet, na adresu <b>{email}</b> jsme poslali potvrzovací odkaz.</p><p>Pokud jste tento účet používali už dříve, nový e-mail se neposílá. Přihlaste se původním heslem, nebo si nastavte nové.</p><Link href="/login" className="auth-inline-link">Přihlásit se</Link><span aria-hidden="true"> · </span><Link href="/forgot-password" className="auth-inline-link">Obnovit heslo</Link></div></div>
          ) : (
            <><div className="auth-account-guidance"><strong>Obnovujete dříve odebraný přístup?</strong><span>Účet nevytvářejte znovu. Použijte <Link href="/login">přihlášení</Link> nebo <Link href="/forgot-password">obnovení hesla</Link>.</span></div><form onSubmit={register} className="auth-form">
              <label><span>Jméno a příjmení</span><input autoComplete="name" required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
              <label><span>Firemní e-mail</span><input type="email" inputMode="email" autoComplete="email" required placeholder="jmeno@hlavica.cz" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label><span>Heslo</span><input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /><small>Alespoň 12 znaků, velké a malé písmeno a číslo.</small></label>
              <label><span>Heslo znovu</span><input type="password" autoComplete="new-password" required minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
              <button type="submit" className="btn primary" disabled={submitting}><Icon name="check"/>{submitting ? "Vytvářím účet…" : "Vytvořit účet"}</button>
              {error && <p className="form-error">{error}</p>}
            </form></>
          )}
          <p className="auth-switch">Už účet máte? <Link href="/login">Přihlásit se</Link></p>
        </div>
        <small className="login-security">Samotná registrace přístup neudělí. E-mail musí být předem pozvaný administrátorem firmy.</small>
      </section>
    </main>
  );
}
