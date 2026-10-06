"use client";

import { useEffect, useRef } from "react";
import { authStyles as styles } from "./auth-shell";

const LENGTH = 6;

// Šest políček pro jednorázový kód. Navenek je to jedna hodnota (řetězec
// číslic), takže stránka ověřuje a odesílá kód stejně jako dřív s jedním
// polem. Vložení celého kódu (ze schránky nebo automatické doplnění z SMS/
// e-mailu přes autocomplete="one-time-code") vyplní všechna políčka.
export function OtpInput({
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
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
  const digits = Array.from({ length: LENGTH }, (_, index) => value[index] ?? "");

  function focus(index: number) {
    refs.current[Math.max(0, Math.min(LENGTH - 1, index))]?.focus();
  }

  function setFrom(index: number, raw: string) {
    const incoming = raw.replace(/\D/g, "");
    if (!incoming) return;
    const current = latest.current;
    const next = (current.slice(0, Math.min(index, current.length)) + incoming).slice(0, LENGTH);
    commit(next);
    focus(next.length >= LENGTH ? LENGTH - 1 : next.length);
  }

  return (
    <div className={styles.otp} role="group" aria-label="Šestimístný kód">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => { refs.current[index] = element; }}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={`Číslice ${index + 1}`}
          maxLength={index === 0 ? LENGTH : 1}
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
