"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell, authStyles as styles } from "@/components/auth/auth-shell";
import { ArrowRight, Lock, Mail, User } from "@/components/landing/landing-icons";
import { isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { passwordProblem } from "@/lib/password-policy";
import { createClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";

type RegistrationKind = "founder" | "invited";

// Registrace (P2). Kdo nemá pozvánku, zakládá firemní účet a po potvrzení
// e-mailu a 2FA projde onboardingem firmy. Kdo pozvánku má, se po potvrzení
// e-mailu rovnou připojí ke své firmě (stejně jako přes odkaz z pozvánky).
export default function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [sent, setSent] = useState(false);
  const [kind, setKind] = useState<RegistrationKind>("founder");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function register(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const normalizedEmail = normalizeEmail(email);
    if (fullName.trim().length < 3) return setError("Zadejte celé jméno uživatele.");
    if (!isValidEmail(normalizedEmail)) return setError("Zadejte platnou e-mailovou adresu.");
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirmation) return setError("Zadaná hesla se neshodují.");
    if (!acceptTerms) return setError("Pro vytvoření účtu je potřeba souhlasit s podmínkami.");
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
    const access = (await accessResponse.json()) as { allowed?: boolean; kind?: string };
    if (!access.allowed) {
      setError("Pro tento e-mail už účet existuje. Přihlaste se, nebo si obnovte heslo.");
      setSubmitting(false);
      return;
    }
    const registrationKind: RegistrationKind = access.kind === "invited" ? "invited" : "founder";
    setKind(registrationKind);

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/mfa`,
        data: { full_name: fullName.trim(), terms_accepted_at: new Date().toISOString() },
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
        setError("Účet se nepodařilo ověřit. Zkuste se přihlásit.");
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
      claimSub="Po ověření e-mailu nastavíte svou firmu a můžete pozvat kolegy."
    >
      <span className={styles.eyebrow}>Nový účet</span>
      <h1 className={styles.title}>Založit firemní účet</h1>
      <p className={styles.sub}>Účet zakladatele firmy. Kolegy pak pozvete sami v nastavení.</p>
      {sent ? (
        <div className={styles.sent}>
          <Mail width={22} height={22} />
          <div>
            <strong>Potvrďte svůj e-mail</strong>
            <p>Na adresu <b>{email}</b> jsme poslali ověřovací odkaz. Otevřete jej a dokončete vytvoření účtu.</p>
            <p>{kind === "invited"
              ? "Na tento e-mail čeká pozvánka do firmy. Po ověření se k ní rovnou připojíte."
              : "Po ověření e-mailu a přihlašovacího kódu nastavíte svou firmu."}</p>
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
              <span className={styles.control}><Mail /><input type="email" inputMode="email" autoComplete="email" required placeholder="jmeno@firma.cz" value={email} onChange={(event) => setEmail(event.target.value)} /></span>
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
          <label className={styles.check}>
            <input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} />
            <span>Souhlasím s <Link href="/podminky" target="_blank">podmínkami</Link> a <Link href="/ochrana-osobnich-udaju" target="_blank">zpracováním osobních údajů</Link>.</span>
          </label>
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
