"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import useSWR from "swr";
import type { DashboardData } from "@/lib/dashboard-summary";
import { apiFetch } from "@/lib/api-client";
import { eskoAnswer, eskoCustomerDebtAnswer, eskoHelpAnswer, eskoIntent, eskoInvoiceSearchAnswer, ESKO_QUESTIONS, type EskoAnswer, type EskoQuestionId } from "@/lib/esko";
import { useAccessProfile } from "@/lib/use-access-role";
import type { Invoice } from "@/types/invoice";
import styles from "./esko-assistant.module.css";

type Message =
  | { from: "user"; text: string }
  | { from: "esko"; answer: EskoAnswer };

const TEASER_KEY = "splatno:esko-teaser-dismissed";
type Pending = { kind: "question"; id: EskoQuestionId } | { kind: "invoice_search" | "customer_debt"; query: string };
type SearchResult = { invoices: Invoice[]; total: number; open_totals: Record<string, number> };

// Plovoucí asistent vpravo dole na všech stránkách aplikace. Data si načte
// až po otevření, aby neprodlužoval běžné načítání stránek.
export function EskoAssistant() {
  const profile = useAccessProfile();
  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState("");
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
    if (pending?.kind !== "question" || !data) return;
    setMessages((current) => [...current, { from: "esko", answer: eskoAnswer(pending.id, data, profile?.role ?? null) }]);
    setPending(null);
  }, [pending, data, profile?.role]);

  // Bez dat Esko neodpoví vymyšleným číslem; řekne to a otázku pustí.
  useEffect(() => {
    if (pending?.kind !== "question" || !error || data) return;
    setMessages((current) => [...current, { from: "esko", answer: { text: "Čísla se teď nepodařilo načíst. Zkuste to prosím za chvíli.", lines: [] } }]);
    setPending(null);
  }, [pending, error, data]);

  useEffect(() => {
    if (pending?.kind !== "invoice_search" && pending?.kind !== "customer_debt") return;
    const controller = new AbortController();
    const query = pending.query;
    const kind = pending.kind;
    void apiFetch<SearchResult>(`/api/invoices?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((result) => {
        const answer = kind === "customer_debt"
          ? eskoCustomerDebtAnswer(query, result.total, result.open_totals, profile?.role ?? null)
          : eskoInvoiceSearchAnswer(query, result.invoices, result.total, profile?.role ?? null);
        setMessages((current) => [...current, { from: "esko", answer }]);
        setPending(null);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setMessages((current) => [...current, { from: "esko", answer: { text: "Faktury se teď nepodařilo prohledat. Zkuste to prosím znovu.", lines: [] } }]);
        setPending(null);
      });
    return () => controller.abort();
  }, [pending, profile?.role]);

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
    setPending({ kind: "question", id });
  }

  function askText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    setMessages((current) => [...current, { from: "user", text }]);
    const intent = eskoIntent(text);
    if (intent.kind === "help") {
      setMessages((current) => [...current, { from: "esko", answer: eskoHelpAnswer() }]);
    } else {
      setPending(intent);
    }
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
        <Image src="/brand/mascot/esko-support.webp" alt="" width={336} height={420} sizes="64px" className={styles.fabImage} />
        <span className={styles.online} aria-hidden="true" />
      </button>

      {open ? (
        <section id="esko-panel" className={styles.panel} role="dialog" aria-label="Asistent Esko">
          <header className={styles.head}>
            <Image src="/brand/mascot/esko-support.webp" alt="" width={336} height={420} sizes="42px" className={styles.avatar} />
            <span>
              <b>Esko · asistent</b>
              <small>Hlídá vaše faktury</small>
            </span>
            <button type="button" className={styles.close} aria-label="Zavřít" onClick={() => setOpen(false)}>×</button>
          </header>

          <div className={styles.messages} ref={listRef} aria-live="polite">
            <p className={`${styles.msg} ${styles.esko}`}>
              Ahoj, tady Esko. Zeptejte se mě vlastními slovy na faktury, platby nebo upomínky. Odpovídám z aktuálních dat vaší firmy.
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

          {/* Návrhy jen pro začátek: jakmile člověk píše nebo se už ptal, ustoupí konverzaci. */}
          {messages.length === 0 && !draft.trim() ? (
            <div className={styles.chips}>
              {ESKO_QUESTIONS.map((question) => (
                <button key={question.id} type="button" disabled={Boolean(pending)} onClick={() => ask(question.id)}>
                  {question.label}
                </button>
              ))}
            </div>
          ) : null}
          <form className={styles.askForm} onSubmit={askText}>
            <label className={styles.srOnly} htmlFor="esko-question">Otázka pro Eska</label>
            <input id="esko-question" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={100} placeholder="Např. najdi fakturu 1443260157" disabled={Boolean(pending)} />
            <button type="submit" disabled={Boolean(pending) || !draft.trim()}>Zeptat se</button>
          </form>
          <p className={styles.footnote}>Esko odpovídá z dat vaší firmy. Platby, faktury ani upomínky samo nemění.</p>
        </section>
      ) : null}
    </>
  );
}
