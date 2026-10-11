"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useI18n } from "./client";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALES, type Locale } from "./locales";
import styles from "./language-switcher.module.css";

const SHORT: Record<Locale, string> = { cs: "CZ", en: "EN" };

function rememberLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

// Přepínač CZ | EN. Volbu uloží do cookie (převezme ji přihlášení). S `hrefs`
// přejde na stránku daného jazyka -- landing má pevnou `/` a `/en`, aby se
// generovala dopředu; bez nich nechá server stránku přerenderovat.
export function LanguageSwitcher({ className, hrefs }: { className?: string; hrefs?: Record<Locale, string> }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale || pending) return;
    rememberLocale(next);
    startTransition(() => {
      if (hrefs) router.push(hrefs[next]);
      else router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t.switcher.label}
      className={`${styles.switcher} ${className ?? ""}`}
      data-pending={pending || undefined}
    >
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          aria-label={t.switcher[option]}
          aria-pressed={option === locale}
          onClick={() => choose(option)}
        >
          {SHORT[option]}
        </button>
      ))}
    </div>
  );
}
