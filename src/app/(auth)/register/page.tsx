"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell, authStyles as styles } from "@/components/auth/auth-shell";
import { ArrowRight, Lock, Mail, User } from "@/components/landing/landing-icons";
import { ALLOWED_EMAIL_DOMAIN, isAllowedCorporateEmail, isCorporateEmailRequired, normalizeEmail } from "@/lib/auth-policy";
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
    if (!isAllowedCorporateEmail(normalizedEmail)) return setError(corporateEmailRequired ? `Registrace je povolena pouze pro e-maily @${ALLOWED_EMAIL_DOMAIN}.` : "Zadejte platnou e-mailovou adresu.");
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
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setError("Přihlašovací účet pro tento e-mail stále existuje. Administrátor musí přístup nejprve odebrat a znovu přidat.");
      setSubmitting(false);
      return;
    }
    if (data.session) {
      const accessResponse = await fetch("/api/auth/access", { method: "POST" });
      if (!accessResponse.ok) {
        await supabase.auth.signOut();
        setError("Pro tento e-mail není připravená firemní pozvánka. Obraťte se na administrátora.");
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
        setError("Přihlášení se nepodařilo bezpečně uložit. Přihlaste se prosím znovu.");
        setSubmitting(false);
        return;
      }
      window.location.assign(access?.mfa_bypassed === true ? "/dashboard" : "/mfa");
      return;
    }
    setEmail(normalizedEmail);
    setSent(true);
    setSubmitting(false);
  }

  return (
    <AuthShell
      art="laptop"
      claim="Společně to zvládneme."
      claimSub="Účet si vytvoříte jen s pozvánkou od administrátora vaší firmy."
    >
      <span className={styles.eyebrow}>Nový účet</span>
      <h1 className={styles.title}>Vytvořte si účet</h1>
      <p className={styles.sub}>Registrace pro uživatele pozvané do firemní aplikace.</p>
      {sent ? (
        <div className={styles.sent}>
          <Mail width={22} height={22} />
          <div>
            <strong>Potvrďte svůj e-mail</strong>
            <p>Na adresu <b>{email}</b> jsme poslali ověřovací odkaz. Otevřete jej a dokončete vytvoření účtu.</p>
          </div>
        </div>
      ) : (
        <form onSubmit={register} className={styles.form}>
          <div className={styles.pair}>
            <label className={styles.field}>
              <span>Jméno a příjmení</span>
              <span className={styles.control}><User /><input autoComplete="name" required placeholder="Jan Novák" value={fullName} onChange={(event) => setFullName(event.target.value)} /></span>
            </label>
            <label className={styles.field}>
              <span>Firemní e-mail</span>
              <span className={styles.control}><Mail /><input type="email" inputMode="email" autoComplete="email" required placeholder={`jmeno@${ALLOWED_EMAIL_DOMAIN}`} value={email} onChange={(event) => setEmail(event.target.value)} /></span>
            </label>
          </div>
          <div className={styles.pair}>
            <label className={styles.field}>
              <span>Heslo</span>
              <span className={styles.control}><Lock /><input type="password" autoComplete="new-password" required minLength={12} placeholder="Zvolte si heslo" value={password} onChange={(event) => setPassword(event.target.value)} /></span>
            </label>
            <label className={styles.field}>
              <span>Heslo znovu</span>
              <span className={styles.control}><Lock /><input type="password" autoComplete="new-password" required minLength={12} placeholder="Zopakujte heslo" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></span>
            </label>
          </div>
          <small className={styles.note} style={{ marginTop: -6 }}>Alespoň 12 znaků, velké a malé písmeno a číslo.</small>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.primary} disabled={submitting}>
            {submitting ? "Vytvářím účet…" : "Vytvořit účet"} <ArrowRight />
          </button>
        </form>
      )}
      <p className={styles.foot}>Už účet máte?<Link href="/login">Přihlásit se</Link></p>
    </AuthShell>
  );
}
