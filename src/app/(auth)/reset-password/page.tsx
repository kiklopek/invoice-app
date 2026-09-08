"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CompanyLogo } from "@/components/company-logo";
import { Icon } from "@/components/icons";
import { passwordProblem } from "@/lib/password-policy";
import { createClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";

export default function ResetPasswordPage() {
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
      if (!data.user) router.replace("/forgot-password");
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
    window.location.assign("/login?error=password-updated");
  }

  return (
    <main className="login-page auth-page">
      <section className="login-card auth-card">
        <div className="login-brand"><CompanyLogo className="login-company-logo" /></div>
        <div className="login-intro"><span>NOVÉ HESLO</span><h1>Nastavení hesla</h1><p>Zvolte nové bezpečné heslo pro svůj firemní účet.</p></div>
        {checking ? <p className="page-state">Ověřuji odkaz…</p> : (
          <form onSubmit={updatePassword} className="auth-form">
            <label><span>Nové heslo</span><input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /><small>Alespoň 12 znaků, velké a malé písmeno a číslo.</small></label>
            <label><span>Nové heslo znovu</span><input type="password" autoComplete="new-password" required minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
            <button type="submit" className="btn primary" disabled={submitting}><Icon name="check"/>{submitting ? "Ukládám…" : "Nastavit nové heslo"}</button>
            {error && <p className="form-error">{error}</p>}
          </form>
        )}
      </section>
    </main>
  );
}
