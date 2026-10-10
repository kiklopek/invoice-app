"use client";

import { PasswordInput } from "@/components/auth/password-input";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell, authStyles as styles } from "@/components/auth/auth-shell";
import { currentEntryLoginPath, useEntryBrand, withEntry } from "@/lib/login-entry";
import { ArrowRight, Lock } from "@/components/landing/landing-icons";
import { passwordProblem } from "@/lib/password-policy";
import { createClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";
import { entryFromSearch } from "@/lib/tenant-entries";

export default function ResetPasswordPage() {
  const brand = useEntryBrand();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSupabaseBrowserConfig()) {
      setError("Obnova hesla není nakonfigurovaná.");
      setChecking(false);
      return;
    }
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.replace(withEntry("/forgot-password", entryFromSearch(new URLSearchParams(window.location.search))));
      else setChecking(false);
    });
  }, [router]);

  async function updatePassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirmation) return setError("Zadaná hesla se neshodují.");
    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError("Heslo se nepodařilo změnit. Odkaz mohl vypršet; požádejte o nový.");
      setSubmitting(false);
      return;
    }
    await supabase.auth.signOut();
    window.location.assign(`${currentEntryLoginPath()}?error=password-updated`);
  }

  return (
    <AuthShell art="laptop" brand={brand} claim="Ještě krok a jste zpět." claimSub="Nové heslo platí hned pro všechna zařízení.">
      <span className={styles.eyebrow}>Nové heslo</span>
      <h1 className={styles.title}>Nastavení hesla</h1>
      <p className={styles.sub}>Zvolte nové bezpečné heslo pro svůj účet.</p>
      {checking ? <p className={styles.note}>Ověřuji odkaz…</p> : (
        <form onSubmit={updatePassword} className={styles.form}>
          <label className={styles.field}>
            <span>Nové heslo</span>
            <span className={styles.control}><Lock /><PasswordInput autoComplete="new-password" enterKeyHint="next" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></span>
            <small>Alespoň 12 znaků, velké a malé písmeno a číslo.</small>
          </label>
          <label className={styles.field}>
            <span>Nové heslo znovu</span>
            <span className={styles.control}><Lock /><PasswordInput autoComplete="new-password" enterKeyHint="done" required minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></span>
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.primary} disabled={submitting}>
            {submitting ? "Ukládám…" : "Nastavit nové heslo"} <ArrowRight />
          </button>
        </form>
      )}
    </AuthShell>
  );
}
