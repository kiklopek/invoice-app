"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell, authStyles as styles } from "@/components/auth/auth-shell";
import { CompanyLogo } from "@/components/company-logo";
import { ArrowRight } from "@/components/landing/landing-icons";
import { rememberNetworkInvitation, forgetNetworkInvitation } from "@/lib/network-invitation-memo";

type Invitation =
  | {
    state: "valid" | "expired" | "accepted";
    inviter: { name: string; ico: string; logo_path: string | null };
    invitee_ico: string;
    invitee_email: string;
    expires_at: string;
    open_count: number;
  }
  | { state: "invalid" | "unavailable" };

type Viewer =
  | { kind: "member"; isAdmin: boolean; email: string }
  | { kind: "no_company"; email: string }
  | { kind: "anonymous" };

function invoicesPhrase(count: number) {
  const noun = count === 1 ? "otevřenou fakturu" : count >= 2 && count <= 4 ? "otevřené faktury" : "otevřených faktur";
  return `${count} ${noun}`;
}

// Pozvánka do Splatno Sítě od firmy, se kterou obchodujete. Kdo Splatno
// nemá, založí si firmu (pozvánka se zapamatuje a po registraci se k ní
// vrátí); kdo ho má, propojení přijme jedním kliknutím.
export function NetworkInvitationClient({ token, optOut, invitation, viewer }: {
  token: string;
  optOut: boolean;
  invitation: Invitation;
  viewer: Viewer;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optedOut, setOptedOut] = useState(false);
  const returnTo = `/pripojeni/${encodeURIComponent(token)}`;

  async function post(action: "accept" | "opt_out") {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/network-invitations/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { connection_id?: string; error?: string } | null;
    if (response?.ok) {
      if (action === "opt_out") {
        setOptedOut(true);
        setBusy(false);
        return;
      }
      forgetNetworkInvitation();
      window.location.replace(data?.connection_id ? `/partneri/${data.connection_id}` : "/partneri");
      return;
    }
    setError(data?.error ?? "Akci se nepodařilo dokončit. Zkuste to prosím znovu.");
    setBusy(false);
  }

  if (optOut || optedOut) {
    return (
      <AuthShell art="phone" claim="Žádné další pozvánky." claimSub="Vaši volbu respektují všechny firmy ve Splatnu.">
        <span className={styles.eyebrow}>SPLATNO SÍŤ</span>
        <h1 className={styles.title}>{optedOut ? "Hotovo, další pozvánky nepřijdou" : "Nepřejete si další pozvánky?"}</h1>
        <p className={styles.sub}>
          {optedOut
            ? "Na tuto adresu už žádná firma pozvánku do Splatna neodešle. Faktury a upomínky, které vám firmy posílají, tím nejsou dotčené."
            : "Po potvrzení vám už žádná firma přes Splatno pozvánku k propojení nepošle. Faktury a upomínky od firem tím nejsou dotčené."}
        </p>
        {error ? <p className={styles.error}>{error}</p> : null}
        {!optedOut && invitation.state !== "invalid" && invitation.state !== "unavailable" ? (
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void post("opt_out")}>
            {busy ? "Ukládám…" : "Nepřeji si další pozvánky"}
          </button>
        ) : null}
        {invitation.state === "invalid" ? <p className={styles.sub}>Odkaz je neplatný.</p> : null}
      </AuthShell>
    );
  }

  if (!("inviter" in invitation) || invitation.state !== "valid") {
    const message = invitation.state === "expired"
      ? "Platnost pozvánky vypršela. Požádejte firmu o novou, nebo se jí ozvěte přímo ve Splatnu."
      : invitation.state === "accepted"
        ? "Pozvánka už byla přijata. Propojení najdete v aplikaci v sekci Partneři."
        : invitation.state === "unavailable"
          ? "Pozvánku se teď nepodařilo ověřit. Zkuste to prosím za chvíli."
          : "Odkaz pozvánky je neplatný.";
    return (
      <AuthShell art="phone" claim="Faktury mezi firmami na jednom místě." claimSub="Splatno Síť">
        <span className={styles.eyebrow}>SPLATNO SÍŤ</span>
        <h1 className={styles.title}>Pozvánka není k dispozici</h1>
        <p className={styles.sub}>{message}</p>
        <p className={styles.foot}>Splatno už používáte? <Link href="/login">Přihlásit se</Link></p>
      </AuthShell>
    );
  }

  const inviter = invitation.inviter;
  return (
    <AuthShell art="wave" claim={<>Faktury mezi firmami<br />na jednom místě.</>} claimSub="Kdo komu kolik dluží, splatnosti a platby – bez přepisování a e-mailových příloh.">
      <span className={styles.eyebrow}>POZVÁNKA DO SPLATNO SÍTĚ</span>
      <div className={styles.inviteCompany}>
        <CompanyLogo src={inviter.logo_path} name={inviter.name} className={styles.inviteLogo} />
        <h1 className={styles.title}>{inviter.name} vás zve k propojení</h1>
      </div>
      <div className="network-invite-facts">
        {invitation.open_count > 0
          ? <p><b>{inviter.name}</b> pro vás ve Splatnu eviduje <b>{invoicesPhrase(invitation.open_count)}</b>.</p>
          : <p><b>{inviter.name}</b> (IČO {inviter.ico}) s vámi chce mít faktury přehledně na jednom místě.</p>}
        <p>Po propojení uvidíte faktury mezi vašimi firmami, co dlužíte vy a co oni, a k fakturám můžete rovnou poslat rozpor nebo oznámit platbu.</p>
        <p>Pozvánka je pro firmu s IČO <b>{invitation.invitee_ico}</b>.</p>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {viewer.kind === "member" ? (
        viewer.isAdmin ? (
          <div className="network-invite-actions">
            <button type="button" className={styles.primary} disabled={busy} onClick={() => void post("accept")}>
              {busy ? "Propojuji…" : "Přijmout propojení"} <ArrowRight />
            </button>
            <p className={styles.note}>Přihlášeni jako {viewer.email}. Partner uvidí faktury, které mu vaše firma vystaví, a vy faktury od něj. Propojení můžete kdykoli zrušit.</p>
          </div>
        ) : (
          <p className={styles.sub}>Jste přihlášeni jako {viewer.email}. Propojení může přijmout administrátor vaší firmy – pošlete mu prosím tento odkaz.</p>
        )
      ) : viewer.kind === "no_company" ? (
        <div className="network-invite-actions">
          <Link className={styles.primary} href="/onboarding" onClick={() => rememberNetworkInvitation(token, inviter.name)}>
            Dokončit nastavení firmy <ArrowRight />
          </Link>
          <p className={styles.note}>Po dokončení se k pozvánce vrátíte z aplikace a propojíte se jedním kliknutím.</p>
        </div>
      ) : (
        <div className="network-invite-actions">
          <Link className={styles.primary} href="/register" onClick={() => rememberNetworkInvitation(token, inviter.name)}>
            Založit firmu ve Splatnu <ArrowRight />
          </Link>
          <Link className="network-invite-secondary" href={`/login?returnTo=${encodeURIComponent(returnTo)}`} onClick={() => rememberNetworkInvitation(token, inviter.name)}>
            Splatno už používám – přihlásit se
          </Link>
        </div>
      )}
      <p className={styles.note}>
        Nepřejete si další pozvánky? <Link href={`${returnTo}?odhlasit=1`}>Odhlásit se</Link>
      </p>
    </AuthShell>
  );
}
