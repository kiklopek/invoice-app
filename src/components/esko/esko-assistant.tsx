"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { DashboardData } from "@/lib/dashboard-summary";
import { eskoAnswer, ESKO_QUESTIONS, type EskoAnswer, type EskoQuestionId } from "@/lib/esko";
import { useAccessProfile } from "@/lib/use-access-role";
import styles from "./esko-assistant.module.css";

type Message =
  | { from: "user"; text: string }
  | { from: "esko"; answer: EskoAnswer };

const TEASER_KEY = "splatno:esko-teaser-dismissed";

// Plovoucí asistent vpravo dole na všech stránkách aplikace. Data si načte
// až po otevření, aby neprodlužoval běžné načítání stránek.
export function EskoAssistant() {
  const profile = useAccessProfile();
  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<EskoQuestionId | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { data, error } = useSWR<DashboardData>(open ? "/api/dashboard" : null);

  useEffect(() => {
    try {
      setTeaser(!window.localStorage.getItem(TEASER_KEY));
    } catch {
      setTeaser(false);
    }
  }, []);

  function hideTeaser() {
    setTeaser(false);
    try {
      window.localStorage.setItem(TEASER_KEY, "1");
    } catch {
      // Bez úložiště se bublina prostě ukáže i příště.
    }
  }

  // Otázka položená před načtením dat se zodpoví, jakmile data dorazí.
  useEffect(() => {
    if (!pending || !data) return;
    setMessages((current) => [...current, { from: "esko", answer: eskoAnswer(pending, data, profile?.role ?? null) }]);
    setPending(null);
  }, [pending, data, profile?.role]);

  // Bez dat Esko neodpoví vymyšleným číslem; řekne to a otázku pustí.
  useEffect(() => {
    if (!pending || !error || data) return;
    setMessages((current) => [...current, { from: "esko", answer: { text: "Čísla se teď nepodařilo načíst. Zkuste to prosím za chvíli.", lines: [] } }]);
    setPending(null);
  }, [pending, error, data]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, pending]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function ask(id: EskoQuestionId) {
    if (pending) return;
    const question = ESKO_QUESTIONS.find((item) => item.id === id);
    if (!question) return;
    setMessages((current) => [...current, { from: "user", text: question.label }]);
    setPending(id);
  }

  return (
    <>
      {teaser && !open ? (
        <div className={styles.teaser} role="note">
          <b>Ahoj, jsem Esko.</b> Zeptejte se mě, co je potřeba dnes vyřešit.
          <button type="button" aria-label="Skrýt" onClick={hideTeaser}>×</button>
        </div>
      ) : null}

      <button
        ref={buttonRef}
        type="button"
        className={styles.fab}
        aria-label={open ? "Zavřít asistenta Esko" : "Otevřít asistenta Esko"}
        aria-expanded={open}
        aria-controls="esko-panel"
        onClick={() => {
          setOpen((value) => !value);
          hideTeaser();
        }}
      >
        <Image src="/brand/mascot/esko.webp" alt="" width={192} height={192} className={styles.fabImage} />
        <span className={styles.online} aria-hidden="true" />
      </button>

      {open ? (
        <section id="esko-panel" className={styles.panel} role="dialog" aria-label="Asistent Esko">
          <header className={styles.head}>
            <Image src="/brand/mascot/esko.webp" alt="" width={192} height={192} className={styles.avatar} />
            <span>
              <b>Esko · asistent</b>
              <small>Hlídá vaše faktury</small>
            </span>
            <button type="button" className={styles.close} aria-label="Zavřít" onClick={() => setOpen(false)}>×</button>
          </header>

          <div className={styles.messages} ref={listRef} aria-live="polite">
            <p className={`${styles.msg} ${styles.esko}`}>
              Ahoj, tady Esko. Odpovím vám z aktuálních čísel vaší firmy. Na co se chcete podívat?
            </p>
            {messages.map((message, index) =>
              message.from === "user" ? (
                <p key={index} className={`${styles.msg} ${styles.user}`}>{message.text}</p>
              ) : (
                <div key={index} className={`${styles.msg} ${styles.esko}`}>
                  <p>{message.answer.text}</p>
                  {message.answer.lines.length ? (
                    <ul>
                      {message.answer.lines.map((line) => (
                        <li key={line.text}>
                          {line.href ? (
                            <Link href={line.href} onClick={() => setOpen(false)}>{line.text}</Link>
                          ) : line.text}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ),
            )}
            {pending ? (
              <p className={`${styles.msg} ${styles.esko} ${styles.thinking}`}>
                Dívám se do faktur…
              </p>
            ) : null}
          </div>

          <div className={styles.chips}>
            {ESKO_QUESTIONS.map((question) => (
              <button key={question.id} type="button" disabled={Boolean(pending)} onClick={() => ask(question.id)}>
                {question.label}
              </button>
            ))}
          </div>
          <p className={styles.footnote}>Esko zatím odpovídá na tyto otázky a nic sám neodesílá.</p>
        </section>
      ) : null}
    </>
  );
}
