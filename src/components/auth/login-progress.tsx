"use client";

import { Icon } from "@/components/icons";
import type { LoginIssue } from "./login-issue";
export type { LoginIssue } from "./login-issue";
import { AuthShell } from "./auth-shell";
import { RibbonMark } from "@/components/landing/landing-icons";
import styles from "./login-progress.module.css";

export type LoginPhase = "credentials" | "environment" | "redirect";

export function LoginProgress({
  phase,
  issue,
  slow,
  onRetry,
  onBack,
}: {
  phase: LoginPhase;
  issue: LoginIssue | null;
  slow: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const active = { credentials: 0, environment: 1, redirect: 2 }[phase];
  return (
    <AuthShell art="wave" claim={null} layout="progress">
      <section
        className={`${styles.content} ${issue ? styles.errorContent : ""}`}
        aria-labelledby="login-progress-title"
        lang="cs"
      >
        <div className={styles.logo} aria-label="Splatno">
          <RibbonMark size={40} />
          <span>splatno</span>
        </div>
        <div
          className={`${styles.indicator} ${issue ? styles.failed : ""}`}
          aria-hidden="true"
        >
          {issue ? (
            <span className={styles.exclamation}>
              <Icon name="alert-circle" />
            </span>
          ) : (
            <svg viewBox="0 0 100 100">
              <path className={styles.track} d="M50 90a40 40 0 0 0 40-40" />
              <path className={styles.arc} d="M16 70a40 40 0 0 1 68-42" />
            </svg>
          )}
        </div>
        <div role="status" aria-live="polite">
          <h1 id="login-progress-title" className={styles.title}>
            {issue ? "Nepodařilo se přihlásit" : "Přihlašujeme vás…"}
          </h1>
          <p className={styles.description}>
            {issue ? (
              issue.code === "network" ? (
                <>
                  Momentálně se nemůžeme připojit k našim serverům.
                  <br />
                  Zkontrolujte své připojení k internetu a zkuste to prosím
                  znovu.
                </>
              ) : (
                "Při přihlašování nastal problém. Zkuste to prosím znovu."
              )
            ) : (
              <>
                Načítáme vaše data a připravujeme prostředí Splatno.
                <br />
                To může trvat jen několik sekund.
              </>
            )}
          </p>
          {!issue && (
            <ol className={styles.steps} aria-label="Průběh přihlášení">
              {[
                "Ověření přihlašovacích údajů",
                "Načítání vašeho prostředí",
                "Příprava aplikace",
              ].map((label, index) => (
                <li
                  key={label}
                  data-state={
                    index < active
                      ? "done"
                      : index === active
                        ? "active"
                        : "pending"
                  }
                  aria-current={index === active ? "step" : undefined}
                >
                  <span className={styles.dot} aria-hidden="true">
                    {index < active && (
                      <svg viewBox="0 0 24 24">
                        <path d="m6 12 4 4 8-9" />
                      </svg>
                    )}
                  </span>
                  <span>
                    {label}
                    <span className={styles.srOnly}>
                      {" "}
                      —{" "}
                      {index < active
                        ? "Dokončeno"
                        : index === active
                          ? "Probíhá"
                          : "Čeká"}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
        {issue && (
          <div className={styles.error} role="alert">
            <span className={styles.panelIcon} aria-hidden="true">
              <Icon name="alert-circle" />
            </span>
            <div>
              <strong>{issue.title}</strong>
              <p>{issue.message}</p>
            </div>
          </div>
        )}
        {!issue && slow && (
          <p className={styles.slow} role="status">
            {phase === "redirect"
              ? "Otevření aplikace trvá déle než obvykle."
              : "Přihlášení trvá déle než obvykle. Stále čekáme na dokončení požadavku."}
          </p>
        )}
        {(issue || slow) && (
          <div className={styles.actions}>
            {issue?.retryable && (
              <button type="button" className={styles.retry} onClick={onRetry}>
                Zkusit znovu
              </button>
            )}
            <button type="button" className={styles.back} onClick={onBack}>
              Zpět na přihlášení
            </button>
          </div>
        )}
      </section>
    </AuthShell>
  );
}
