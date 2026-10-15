"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/i18n/client";
import { authStyles as styles } from "./auth-shell";
import { normalizeVerificationCode, VERIFICATION_CODE_LENGTH } from "@/lib/verification-code";

// Políčka pro jednorázový kód. Navenek je to jedna hodnota (řetězec
// číslic), takže stránka ověřuje a odesílá kód stejně jako dřív s jedním
// polem. Vložení celého kódu (ze schránky nebo automatické doplnění z SMS/
// e-mailu přes autocomplete="one-time-code") vyplní všechna políčka.
export function OtpInput({
  value,
  onChange,
  disabled,
  autoFocus,
  length = VERIFICATION_CODE_LENGTH,
  ariaLabel,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  length?: number;
  ariaLabel?: string;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const common = useI18n().t.auth.common;
  // Poslední zapsaný kód. Při rychlém psaní přijde další číslice dřív, než
  // React překreslí políčka s novou hodnotou; bez toho by se číslice ztrácely.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  function commit(next: string) {
    latest.current = next;
    onChange(next);
  }
  const digits = Array.from({ length }, (_, index) => value[index] ?? "");

  function focus(index: number) {
    refs.current[Math.max(0, Math.min(length - 1, index))]?.focus();
  }

  function setFrom(index: number, raw: string) {
    const incoming = normalizeVerificationCode(raw);
    if (!incoming) return;
    const current = latest.current;
    const next = (current.slice(0, Math.min(index, current.length)) + incoming).slice(0, length);
    commit(next);
    focus(next.length >= length ? length - 1 : next.length);
  }

  return (
    <div className={styles.otp} style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }} role="group" aria-label={ariaLabel ?? common.otpGroup}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => { refs.current[index] = element; }}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={common.otpDigit(index + 1)}
          maxLength={index === 0 ? length : 1}
          autoFocus={autoFocus && index === 0}
          disabled={disabled}
          value={digit}
          data-filled={digit ? "" : undefined}
          onChange={(event) => setFrom(index, event.target.value)}
          onPaste={(event) => {
            event.preventDefault();
            setFrom(0, event.clipboardData.getData("text"));
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace") {
              event.preventDefault();
              const current = latest.current;
              if (current[index]) commit(current.slice(0, index));
              else if (index > 0) {
                commit(current.slice(0, index - 1));
                focus(index - 1);
              }
            } else if (event.key === "ArrowLeft") focus(index - 1);
            else if (event.key === "ArrowRight") focus(index + 1);
          }}
          onFocus={(event) => {
            // Kód se píše zleva: kliknutí za prázdné políčko skočí na první volné.
            if (index > latest.current.length) focus(latest.current.length);
            else event.target.select();
          }}
        />
      ))}
    </div>
  );
}
