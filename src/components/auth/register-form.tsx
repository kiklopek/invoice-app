"use client";

import { PasswordInput } from "@/components/auth/password-input";
import Link from "next/link";
import { useState } from "react";
import { AuthShell, authStyles as styles, type AuthBrand } from "@/components/auth/auth-shell";
import { ArrowRight, Lock, Mail, User } from "@/components/landing/landing-icons";
import { emailMatchesDomain, HLAVICA_EMAIL_DOMAIN, isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { withEntry } from "@/lib/login-entry";
import { HLAVICA_ENTRY } from "@/lib/tenant-entries";
import { passwordProblem } from "@/lib/password-policy";
import { createClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";

type RegistrationKind = "founder" | "invited";

// Registrace. Dva oddělené vstupy:
// - "splatno" (/register): kdo nemá pozvánku, zakládá firemní účet a po
//   potvrzení e-mailu a 2FA projde onboardingem; kdo pozvánku má, se po
//   potvrzení e-mailu připojí ke své firmě. S R. Hlavica nesouvisí.
// - "hlavica" (/hlavica/registrace): jako dřív, jen e-mail @hlavica.cz,
//   který administrátor R. Hlavica předem pozval.
export function RegisterForm({ brand }: { brand: AuthBrand }) {
  const hlavica = brand === "hlavica";
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
    if (hlavica && !emailMatchesDomain(normalizedEmail, HLAVICA_EMAIL_DOMAIN)) return setError(`Registrace je povolena pouze pro e-maily @${HLAVICA_EMAIL_DOMAIN}.`);
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirmation) return setError("Zadaná hesla se neshodují.");
    if (!hlavica && !acceptTerms) return setError("Pro vytvoření účtu je potřeba souhlasit s podmínkami.");
    if (!hasSupabaseBrowserConfig()) return setError("Registrace není nakonfigurovaná. Doplňte Supabase proměnné prostředí.");

    setSubmitting(true);
    const accessResponse = await fetch("/api/auth/registration-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, entry: brand }),
    });
    if (!accessResponse.ok) {
      setError("Ověření firemního přístupu se nepodařilo. Zkuste to prosím znovu.");
      setSubmitting(false);
      return;
    }
    const access = (await accessResponse.json()) as { allowed?: boolean; kind?: string };
    if (!access.allowed) {
      setError(access.kind === "member"
        ? "Pro tento e-mail už účet existuje. Přihlaste se, nebo si obnovte heslo."
        : access.kind === "hlavica"
          ? "hlavica"
          : access.kind === "disposable"
            ? "Firemní účet nejde založit z jednorázové e-mailové schránky. Použijte prosím pracovní e-mail."
            : "Pro tento e-mail zatím nelze vytvořit účet, protože nebyl administrátorem firmy přidán do systému. Kontaktujte prosím jednatele firmy.");
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
        emailRedirectTo: `${window.location.origin}${withEntry("/auth/callback?next=/mfa", brand)}`,
        data: hlavica
          ? { full_name: fullName.trim() }
          : { full_name: fullName.trim(), terms_accepted_at: new Date().toISOString() },
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
      claim="Společně to zvládneme."
      claimSub={hlavica
        ? "Účet si vytvoříte jen s pozvánkou od administrátora vaší firmy."
        : "Po ověření e-mailu nastavíte svou firmu a můžete pozvat kolegy."}
    >
      <span className={styles.eyebrow}>Nový účet</span>
      <h1 className={styles.title}>{hlavica ? "Vytvořte si účet" : "Založit firemní účet"}</h1>
      <p className={styles.sub}>{hlavica
        ? "Registrace pro uživatele pozvané do firemní aplikace."
        : "Účet zakladatele firmy. Kolegy pak pozvete sami v nastavení."}</p>
      {sent ? (
        <div className={styles.sent}>
          <Mail width={22} height={22} />
          <div>
            <strong>Potvrďte svůj e-mail</strong>
            <p>Na adresu <b>{email}</b> jsme poslali ověřovací odkaz. Otevřete jej a dokončete vytvoření účtu.</p>
            {hlavica ? null : <p>{kind === "invited"
              ? "Na tento e-mail čeká pozvánka do firmy. Po ověření se k ní rovnou připojíte."
              : "Po ověření e-mailu a přihlašovacího kódu nastavíte svou firmu."}</p>}
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
              <span className={styles.control}><Mail /><input type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" inputMode="email" autoComplete="email" required placeholder={hlavica ? `jmeno@${HLAVICA_EMAIL_DOMAIN}` : "jmeno@firma.cz"} value={email} onChange={(event) => setEmail(event.target.value)} /></span>
            </label>
          </div>
          <div className={styles.pair}>
            <label className={styles.field}>
              <span>Heslo</span>
              <span className={styles.control}><Lock /><PasswordInput autoComplete="new-password" enterKeyHint="next" required minLength={12} placeholder="Zvolte si heslo" value={password} onChange={(event) => setPassword(event.target.value)} /></span>
            </label>
            <label className={styles.field}>
              <span>Heslo znovu</span>
              <span className={styles.control}><Lock /><PasswordInput autoComplete="new-password" enterKeyHint="done" required minLength={12} placeholder="Zopakujte heslo" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></span>
            </label>
          </div>
          <small className={styles.note} style={{ marginTop: -6 }}>Alespoň 12 znaků, velké a malé písmeno a číslo.</small>
          {hlavica ? null : (
            <label className={styles.check}>
              <input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} />
              <span>Souhlasím s <Link href="/podminky" target="_blank">podmínkami</Link> a <Link href="/ochrana-osobnich-udaju" target="_blank">zpracováním osobních údajů</Link>.</span>
            </label>
          )}
          {error === "hlavica" ? (
            <p className={styles.error}>Pro tento e-mail je registrace na vstupu vaší firmy: <Link href={`${HLAVICA_ENTRY.path}/registrace`}>{`splatno.cz${HLAVICA_ENTRY.path}/registrace`}</Link>.</p>
          ) : error ? <p className={styles.error}>{error}</p> : null}
          <button type="submit" className={styles.primary} disabled={submitting}>
            {submitting ? "Vytvářím účet…" : "Vytvořit účet"} <ArrowRight />
          </button>
        </form>
      )}
      <p className={styles.foot}>Už účet máte?<Link href="/login">Přihlásit se</Link></p>
    </AuthShell>
  );
}
