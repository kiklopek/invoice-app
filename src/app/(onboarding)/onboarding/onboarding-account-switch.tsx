"use client";

import { useRef, useState } from "react";
import { ArrowLeft } from "@/components/landing/landing-icons";
import { signOutCurrentSession } from "@/lib/sign-out";
import { loginEntryPath } from "@/lib/login-entry";
import styles from "./onboarding.module.css";

export function OnboardingAccountSwitch({ onBeforeSignOut, onSignOutFailed }: {
  onBeforeSignOut: () => void;
  onSignOutFailed: () => void;
}) {
  const pending = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchAccount() {
    if (pending.current) return;
    pending.current = true;
    setSigningOut(true);
    setError(null);
    onBeforeSignOut();
    try {
      await signOutCurrentSession();
      // A full navigation discards the old authenticated Router Cache.
      // Following a login link before logout just redirects back to onboarding.
      window.location.replace(loginEntryPath());
    } catch {
      onSignOutFailed();
      pending.current = false;
      setSigningOut(false);
      setError("Odhlášení se nepodařilo. Zkontrolujte připojení a zkuste to znovu.");
    }
  }

  return (
    <div className={styles.accountSwitch}>
      <button type="button" onClick={() => void switchAccount()} disabled={signingOut}>
        <ArrowLeft aria-hidden="true" />
        <span>{signingOut ? "Odhlašuji…" : "Zpátky na přihlášení"}</span>
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
