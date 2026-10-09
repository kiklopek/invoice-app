"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "@/components/landing/landing-icons";
import styles from "./auth-shell.module.css";

// Pole hesla s tlačítkem Zobrazit/Skrýt. Na telefonu se heslo píše
// naslepo špatně; zobrazení je volba uživatele a po odeslání se nemění.
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <input
        {...props}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={styles.passwordInput}
      />
      <button
        type="button"
        className={styles.reveal}
        aria-label={visible ? "Skrýt heslo" : "Zobrazit heslo"}
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff /> : <Eye />}
      </button>
    </>
  );
}
