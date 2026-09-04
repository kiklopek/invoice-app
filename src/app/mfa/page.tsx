"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { CompanyLogo } from "@/components/company-logo";

export default function MfaPage() {
  const requested = useRef(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeAvailable, setCodeAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const requestCode = useCallback(async (resend = false) => {
    if (resend) setResending(true);
    else setLoading(true);
    if (!resend) setCodeAvailable(false);
    setError(null);
    try {
      const response = await fetch("/api/auth/email-mfa/send", { method: "POST", credentials: "same-origin" });
      const data = await response.json().catch(() => ({})) as {
        can_verify?: boolean;
        code?: string;
        email?: string;
        error?: string;
        retry_after?: number;
        verified?: boolean;
      };
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (data.verified) {
        window.location.replace("/dashboard");
        return;
      }
      if (data.email) setEmail(data.email);
      if (typeof data.retry_after === "number") setCooldown(Math.max(1, Math.ceil(data.retry_after)));
      if (!response.ok) {
        setCodeAvailable(data.can_verify === true);
        setError(data.error || "Kód se nepodařilo odeslat.");
        return;
      }
      setCodeAvailable(true);
      setCooldown(60);
    } catch {
      setError("Kód se nepodařilo odeslat. Zkontrolujte připojení.");
    } finally {
      setLoading(false);
      setResending(false);
    }
  }, []);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void requestCode();
  }, [requestCode]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Zadejte platný šestimístný kód.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/email-mfa/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await response.json().catch(() => ({})) as { code?: string; error?: string; verified?: boolean };
      if (response.ok && data.verified) {
        window.location.replace("/dashboard");
        return;
      }
      if (data.code === "challenge_expired" || data.code === "challenge_missing") setCodeAvailable(false);
      setError(data.error || "Kód se nepodařilo ověřit.");
      setCode("");
    } catch {
      setError("Kód se nepodařilo ověřit. Zkontrolujte připojení.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand"><CompanyLogo className="login-company-logo" /></div>
        <div className="login-intro">
          <span>OVĚŘENÍ E-MAILEM</span>
          <h1>Druhé ověření</h1>
          <p>{loading
            ? "Odesíláme jednorázový kód…"
            : codeAvailable
              ? `Šestimístný kód jsme poslali na ${email || "váš firemní e-mail"}.`
              : "Ověřovací kód zatím nebyl odeslán."}</p>
        </div>

        {!loading && codeAvailable && (
          <form onSubmit={verify}>
            <label>
              <span>Šestimístný kód</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                placeholder="123456"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </label>
            <button type="submit" className="btn primary" disabled={submitting}>
              <Icon name="check" />{submitting ? "Ověřuji…" : "Ověřit a pokračovat"}
            </button>
          </form>
        )}

        {error && <p className="form-error">{error}</p>}
        {!loading && (
          <button
            type="button"
            className="auth-text-button"
            disabled={resending || cooldown > 0}
            onClick={() => void requestCode(true)}
            style={{ marginTop: 16 }}
          >
            {resending ? "Odesílám…" : cooldown > 0 ? `Poslat nový kód za ${cooldown} s` : "Poslat nový kód"}
          </button>
        )}
        <small className="login-security">Kód platí 10 minut, lze jej použít pouze jednou a po pěti chybných pokusech se zablokuje.</small>
      </section>
    </main>
  );
}
