"use client";

import { PasswordInput } from "@/components/auth/password-input";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell, authStyles as styles } from "@/components/auth/auth-shell";
import { currentEntryLoginPath, useEntryBrand, withEntry } from "@/lib/login-entry";
import { ArrowRight, Lock } from "@/components/landing/landing-icons";
import { passwordRule } from "@/lib/password-policy";
import { useI18n } from "@/i18n/client";
import { createClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";

export default function ResetPasswordPage() {
  const brand = useEntryBrand();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const copy = t.auth.reset;
  const common = t.auth.common;
  const notConfigured = copy.errors.notConfigured;

  useEffect(() => {
    if (!hasSupabaseBrowserConfig()) {
      setError(notConfigured);
      setChecking(false);
      return;
    }
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.replace(withEntry("/forgot-password", new URLSearchParams(window.location.search).get("vstup") === "hlavica" ? "hlavica" : "splatno"));
      else setChecking(false);
    });
  }, [router, notConfigured]);

  async function updatePassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const rule = passwordRule(password);
    if (rule) return setError(common.passwordRules[rule]);
    if (password !== confirmation) return setError(common.passwordsMismatch);
    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(copy.errors.updateFailed);
      setSubmitting(false);
      return;
    }
    await supabase.auth.signOut();
    window.location.assign(`${currentEntryLoginPath()}?error=password-updated`);
  }

  return (
    <AuthShell art="laptop" brand={brand} claim={copy.claim} claimSub={copy.claimSub}>
      <span className={styles.eyebrow}>{copy.eyebrow}</span>
      <h1 className={styles.title}>{copy.title}</h1>
      <p className={styles.sub}>{copy.sub}</p>
      {checking ? <p className={styles.note}>{copy.checking}</p> : (
        <form onSubmit={updatePassword} className={styles.form}>
          <label className={styles.field}>
            <span>{copy.newPassword}</span>
            <span className={styles.control}><Lock /><PasswordInput autoComplete="new-password" enterKeyHint="next" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></span>
            <small>{common.passwordHint}</small>
          </label>
          <label className={styles.field}>
            <span>{copy.newPasswordAgain}</span>
            <span className={styles.control}><Lock /><PasswordInput autoComplete="new-password" enterKeyHint="done" required minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></span>
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.primary} disabled={submitting}>
            {submitting ? copy.submitting : copy.submit} <ArrowRight />
          </button>
        </form>
      )}
    </AuthShell>
  );
}
