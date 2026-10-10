"use client";

import { PasswordInput } from "@/components/auth/password-input";
import Link from "next/link";
import { useState } from "react";
import { AuthShell, authStyles as styles } from "@/components/auth/auth-shell";
import { CompanyLogo } from "@/components/company-logo";
import { ArrowRight, Lock, Mail, User } from "@/components/landing/landing-icons";
import { invitationApiError } from "@/i18n/api-errors";
import { useI18n } from "@/i18n/client";
import { formatDate } from "@/i18n/format";
import { passwordRule } from "@/lib/password-policy";
import type { AccessRole } from "@/lib/role-access";
import { signOutCurrentSession } from "@/lib/sign-out";

type Invitation =
  | { status: "valid"; email: string; role: AccessRole; companyName: string; companyLogo: string | null; expiresAt: string }
  | { status: "invalid" | "expired" | "unavailable" };

// Přijetí pozvánky: e-mail je daný pozvánkou a nejde změnit. Kdo už účet
// má (např. si dřív zaregistroval prázdný účet), zadá jeho heslo a připojí
// se; nový člověk si heslo nastaví. Onboarding firmy se tu nedělá.
export function InvitationClient({ token, invitation, signedInAs }: { token: string; invitation: Invitation; signedInAs: string | null }) {
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [existingAccount, setExistingAccount] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const { locale, t } = useI18n();
  const copy = t.auth.invite;
  const common = t.auth.common;

  if (invitation.status !== "valid") {
    const message = invitation.status === "expired"
      ? copy.expired
      : invitation.status === "unavailable"
        ? copy.unavailable
        : copy.invalid;
    return (
      <AuthShell art="phone" claim={copy.invalidClaim} claimSub={copy.invalidClaimSub}>
        <span className={styles.eyebrow}>{copy.eyebrow}</span>
        <h1 className={styles.title}>{copy.invalidTitle}</h1>
        <p className={styles.sub}>{message}</p>
        <p className={styles.foot}>{copy.alreadyAccepted}<Link href="/login">{common.login}</Link></p>
      </AuthShell>
    );
  }

  const otherAccount = signedInAs && signedInAs !== invitation.email;

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    if (invitation.status !== "valid") return;
    setError(null);
    if (fullName.trim().length < 3) return setError(copy.errors.fullName);
    const rule = existingAccount ? null : passwordRule(password);
    if (rule) return setError(common.passwordRules[rule]);
    if (!existingAccount && password !== confirmation) return setError(common.passwordsMismatch);
    if (!acceptTerms) return setError(copy.errors.terms);
    setSubmitting(true);
    const response = await fetch(`/api/invitations/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: fullName.trim(), password, acceptTerms }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { redirect?: string; error?: string; code?: string } | null;
    if (response?.ok && data?.redirect) {
      window.location.replace(data.redirect);
      return;
    }
    if (data?.code === "existing_account_password") setExistingAccount(true);
    setError(invitationApiError(locale, data, copy.errors.failed));
    setSubmitting(false);
  }

  return (
    <AuthShell art="wave" claim={<>{copy.welcome}<br />{invitation.companyName.replace(/\.$/, "")}.</>} claimSub={copy.claimSub}>
      <span className={styles.eyebrow}>{copy.validEyebrow}</span>
      <div className={styles.inviteCompany}>
        <CompanyLogo src={invitation.companyLogo} name={invitation.companyName} className={styles.inviteLogo} />
        <h1 className={styles.title}>{copy.invites(invitation.companyName)}</h1>
      </div>
      <p className={styles.sub}>{copy.role}<b>{common.roles[invitation.role]}</b>{copy.validUntil(formatDate(locale, invitation.expiresAt))}</p>

      {otherAccount ? (
        <div className={styles.sent}>
          <User width={22} height={22} />
          <div>
            <strong>{copy.signedInAs(signedInAs)}</strong>
            <p>{copy.otherEmail(invitation.email)}</p>
            <button type="button" className={styles.textButton} disabled={signingOut} onClick={async () => {
              setSigningOut(true);
              await signOutCurrentSession().catch(() => null);
              window.location.reload();
            }}>{signingOut ? common.signingOut : copy.signOutContinue}</button>
          </div>
        </div>
      ) : (
        <form onSubmit={accept} className={styles.form}>
          <label className={styles.field}>
            <span>{common.email}</span>
            <span className={styles.control}><Mail /><input type="email" value={invitation.email} readOnly aria-readonly="true" /></span>
          </label>
          <label className={styles.field}>
            <span>{common.fullName}</span>
            <span className={styles.control}><User /><input autoComplete="name" required placeholder={common.namePlaceholder} value={fullName} onChange={(event) => setFullName(event.target.value)} /></span>
          </label>
          {existingAccount ? (
            <label className={styles.field}>
              <span>{copy.existingPassword}</span>
              <span className={styles.control}><Lock /><PasswordInput autoComplete="current-password" enterKeyHint="go" required value={password} onChange={(event) => setPassword(event.target.value)} /></span>
              <small>{copy.existingHint}<Link href="/forgot-password">{copy.forgot}</Link></small>
            </label>
          ) : (
            <div className={styles.pair}>
              <label className={styles.field}>
                <span>{common.password}</span>
                <span className={styles.control}><Lock /><PasswordInput autoComplete="new-password" enterKeyHint="next" required minLength={12} placeholder={common.choosePassword} value={password} onChange={(event) => setPassword(event.target.value)} /></span>
              </label>
              <label className={styles.field}>
                <span>{common.passwordAgain}</span>
                <span className={styles.control}><Lock /><PasswordInput autoComplete="new-password" enterKeyHint="done" required minLength={12} placeholder={common.repeatPassword} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></span>
              </label>
            </div>
          )}
          {!existingAccount ? <small className={styles.note} style={{ marginTop: -6 }}>{common.passwordHint}</small> : null}
          <label className={styles.check}>
            <input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} />
            <span>{common.terms.before}<Link href="/podminky" target="_blank">{common.terms.terms}</Link>{common.terms.between}<Link href="/ochrana-osobnich-udaju" target="_blank">{common.terms.privacy}</Link>{common.terms.after}</span>
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.primary} disabled={submitting}>
            {submitting ? copy.submitting : copy.submit} <ArrowRight />
          </button>
        </form>
      )}
      <p className={styles.note}>{copy.note}</p>
    </AuthShell>
  );
}
