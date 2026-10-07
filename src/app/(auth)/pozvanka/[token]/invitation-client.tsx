"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell, authStyles as styles } from "@/components/auth/auth-shell";
import { CompanyLogo } from "@/components/company-logo";
import { ArrowRight, Lock, Mail, User } from "@/components/landing/landing-icons";
import { passwordProblem } from "@/lib/password-policy";
import { roleNames, type AccessRole } from "@/lib/role-access";
import { signOutCurrentSession } from "@/lib/sign-out";

type Invitation =
  | { status: "valid"; email: string; role: AccessRole; companyName: string; companyLogo: string | null; expiresAt: string }
  | { status: "invalid" | "expired" | "unavailable" };

function czechDate(value: string) {
  const date = new Date(value);
  return `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}`;
}

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

  if (invitation.status !== "valid") {
    const message = invitation.status === "expired"
      ? "Platnost pozvánky vypršela. Požádejte administrátora své firmy, ať vám pošle novou."
      : invitation.status === "unavailable"
        ? "Pozvánku se teď nepodařilo ověřit. Zkuste odkaz otevřít znovu za chvíli."
        : "Odkaz už neplatí. Pozvánka mohla být přijata, zrušena, nebo vám administrátor poslal novější.";
    return (
      <AuthShell art="phone" claim="Pozvánka do firmy." claimSub="Odkaz z e-mailu platí 7 dní a jen jednou.">
        <span className={styles.eyebrow}>Pozvánka</span>
        <h1 className={styles.title}>Odkaz nelze použít</h1>
        <p className={styles.sub}>{message}</p>
        <p className={styles.foot}>Už jste pozvánku přijali?<Link href="/login">Přihlásit se</Link></p>
      </AuthShell>
    );
  }

  const otherAccount = signedInAs && signedInAs !== invitation.email;

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    if (invitation.status !== "valid") return;
    setError(null);
    if (fullName.trim().length < 3) return setError("Zadejte celé jméno.");
    const problem = existingAccount ? null : passwordProblem(password);
    if (problem) return setError(problem);
    if (!existingAccount && password !== confirmation) return setError("Zadaná hesla se neshodují.");
    if (!acceptTerms) return setError("Pro vstup je potřeba souhlasit s podmínkami.");
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
    setError(data?.error ?? "Pozvánku se nepodařilo přijmout. Zkontrolujte připojení a zkuste to znovu.");
    setSubmitting(false);
  }

  return (
    <AuthShell art="wave" claim={<>Vítejte v týmu<br />{invitation.companyName.replace(/\.$/, "")}.</>} claimSub="Faktury, platby a upomínky na jednom místě.">
      <span className={styles.eyebrow}>Pozvánka do firmy</span>
      <div className={styles.inviteCompany}>
        <CompanyLogo src={invitation.companyLogo} name={invitation.companyName} className={styles.inviteLogo} />
        <h1 className={styles.title}>{invitation.companyName} vás zve do Splatna</h1>
      </div>
      <p className={styles.sub}>Vaše role: <b>{roleNames[invitation.role]}</b>. Pozvánka platí do {czechDate(invitation.expiresAt)}.</p>

      {otherAccount ? (
        <div className={styles.sent}>
          <User width={22} height={22} />
          <div>
            <strong>Jste přihlášeni jako {signedInAs}</strong>
            <p>Pozvánka je pro {invitation.email}. Pro přijetí se nejdřív odhlaste.</p>
            <button type="button" className={styles.textButton} disabled={signingOut} onClick={async () => {
              setSigningOut(true);
              await signOutCurrentSession().catch(() => null);
              window.location.reload();
            }}>{signingOut ? "Odhlašuji…" : "Odhlásit a pokračovat"}</button>
          </div>
        </div>
      ) : (
        <form onSubmit={accept} className={styles.form}>
          <label className={styles.field}>
            <span>E-mail</span>
            <span className={styles.control}><Mail /><input type="email" value={invitation.email} readOnly aria-readonly="true" /></span>
          </label>
          <label className={styles.field}>
            <span>Jméno a příjmení</span>
            <span className={styles.control}><User /><input autoComplete="name" required placeholder="Jan Novák" value={fullName} onChange={(event) => setFullName(event.target.value)} /></span>
          </label>
          {existingAccount ? (
            <label className={styles.field}>
              <span>Heslo k vašemu účtu</span>
              <span className={styles.control}><Lock /><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></span>
              <small>Pro tento e-mail už účet máte. <Link href="/forgot-password">Zapomenuté heslo?</Link></small>
            </label>
          ) : (
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
          )}
          {!existingAccount ? <small className={styles.note} style={{ marginTop: -6 }}>Alespoň 12 znaků, velké a malé písmeno a číslo.</small> : null}
          <label className={styles.check}>
            <input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} />
            <span>Souhlasím s <Link href="/podminky" target="_blank">podmínkami</Link> a <Link href="/ochrana-osobnich-udaju" target="_blank">zpracováním osobních údajů</Link>.</span>
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.primary} disabled={submitting}>
            {submitting ? "Připojuji…" : "Vstoupit do firmy"} <ArrowRight />
          </button>
        </form>
      )}
      <p className={styles.note}>Příště se přihlásíte běžně e-mailem, heslem a kódem z e-mailu.</p>
    </AuthShell>
  );
}
