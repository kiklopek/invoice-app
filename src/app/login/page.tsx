"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";

// Přihlášení přes magic link. Přístup k firemním datům následně ověřuje
// server podle organization_members; samotný účet v Auth nestačí.
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason === "access") setError("Tento e-mail nemá přístup k firemní aplikaci. Obraťte se na administrátora.");
    else if (reason === "callback") setError("Přihlašovací odkaz je neplatný nebo už vypršel. Pošlete si nový.");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError("Přihlašovací odkaz se nepodařilo odeslat. Zkuste to znovu.");
    } else {
      setSent(true);
    }
  }

  return <main className="login-page"><section className="login-card"><div className="login-brand"><div className="brand-mark"><span>R</span></div><div><strong>R. Hlavica</strong><small>DŘEVO & LES</small></div></div><div className="login-intro"><span>INTERNÍ APLIKACE</span><h1>Přehled pohledávek</h1><p>Bezpečný přístup pro účetní oddělení.</p></div>{sent ? <div className="login-sent"><Icon name="check"/><div><strong>Odkaz je na cestě</strong><p>Poslali jsme ho na <b>{email}</b>. Zkontrolujte svou e-mailovou schránku.</p></div></div> : <form onSubmit={handleSubmit}><label><span>Firemní e-mail</span><input type="email" required placeholder="jmeno@hlavica.cz" value={email} onChange={(e) => setEmail(e.target.value)}/></label><button type="submit" className="btn primary"><Icon name="mail"/>Poslat přihlašovací odkaz</button>{error && <p className="form-error">{error}</p>}</form>}<small className="login-security">Přístup mají pouze předem povolené firemní účty.</small></section></main>;
}
