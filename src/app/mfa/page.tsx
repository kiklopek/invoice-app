"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import { CompanyLogo } from "@/components/company-logo";

type Factor = { id: string; status: string; friendly_name?: string };

export default function MfaPage() {
  const router = useRouter();
  const [factor, setFactor] = useState<Factor | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function initialize() {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/login");
        return;
      }

      const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance?.currentLevel === "aal2") {
        router.replace("/dashboard");
        return;
      }

      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) {
        if (active) setError("Nepodařilo se načíst nastavení 2FA.");
        if (active) setLoading(false);
        return;
      }

      const verified = factors.totp.find((item) => item.status === "verified");
      if (verified) {
        if (active) setFactor(verified);
        if (active) setLoading(false);
        return;
      }


      const { data: enrollment, error: enrollmentError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Hlavica faktury",
      });
      if (enrollmentError || !enrollment) {
        if (active) setError("Nepodařilo se připravit 2FA. Odhlaste se a zkuste to znovu.");
      } else if (active) {
        setFactor({ id: enrollment.id, status: "unverified", friendly_name: enrollment.friendly_name });
        setQrCode(enrollment.totp.qr_code);
        setSecret(enrollment.totp.secret);
      }
      if (active) setLoading(false);
    }
    initialize();
    return () => { active = false; };
  }, [router]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!factor || !/^\d{6}$/.test(code)) {
      setError("Zadejte platný šestimístný kód.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setSubmitting(false);
    if (verifyError) {
      setError("Kód není platný nebo už vypršel. Zkuste nový kód z aplikace.");
      setCode("");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand"><CompanyLogo className="login-company-logo" /></div>
        <div className="login-intro"><span>DVOJÍ OVĚŘENÍ</span><h1>Ověření 2FA</h1><p>{qrCode ? "Naskenujte QR kód v autentizační aplikaci a zadejte vygenerovaný kód." : "Zadejte kód z autentizační aplikace."}</p></div>
        {loading ? <p>Načítám zabezpečení…</p> : (
          <>
            {qrCode && <div style={{ textAlign: "center", marginBottom: 20 }}><img src={qrCode} alt="QR kód pro nastavení 2FA" width={200} height={200}/>{secret && <p><small>Záložní tajný klíč: <code>{secret}</code></small></p>}</div>}
            <form onSubmit={verify}>
              <label><span>Šestimístný kód</span><input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}/></label>
              <button type="submit" className="btn primary" disabled={submitting || !factor}><Icon name="check"/>{submitting ? "Ověřuji…" : "Ověřit a pokračovat"}</button>
              {error && <p className="form-error">{error}</p>}
            </form>
            <button type="button" className="btn" onClick={signOut} style={{ marginTop: 12 }}>Odhlásit se</button>
          </>
        )}
      </section>
    </main>
  );
}
