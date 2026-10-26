"use client";

import { CloseIcon } from "@/components/close-icon";
import { Icon } from "@/components/icons";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import useSWR from "swr";
import type { DashboardData } from "@/lib/dashboard-summary";
import { apiFetch } from "@/lib/api-client";
import {
  eskoAnswer,
  eskoCustomerDebtAnswer,
  eskoHelpAnswer,
  eskoIntent,
  eskoInvoiceSearchAnswer,
  ESKO_QUESTIONS,
  type EskoAnswer,
  type EskoQuestionId,
} from "@/lib/esko";
import { useAccessProfile } from "@/lib/use-access-role";
import type { Invoice } from "@/types/invoice";
import styles from "./esko-assistant.module.css";
import { Modal } from "@/components/modal";
import { useEskoAssistant } from "./esko-context";

type Message =
  { from: "user"; text: string } | { from: "esko"; answer: EskoAnswer };

type Pending =
  | { kind: "question"; id: EskoQuestionId }
  | { kind: "invoice_search" | "customer_debt"; query: string };
type SearchResult = {
  invoices: Invoice[];
  total: number;
  open_totals: Record<string, number>;
};

// Navigation owns visibility; conversation stays mounted across dialog closes.
export function EskoAssistant() {
  const profile = useAccessProfile();
  const { open, closeAssistant: close } = useEskoAssistant();
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState("");
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const { data, error } = useSWR<DashboardData>(open ? "/api/dashboard" : null);

  // Otázka položená před načtením dat se zodpoví, jakmile data dorazí.
  useEffect(() => {
    if (pending?.kind !== "question" || !data) return;
    setMessages((current) => [
      ...current,
      {
        from: "esko",
        answer: eskoAnswer(pending.id, data, profile?.role ?? null),
      },
    ]);
    setPending(null);
  }, [pending, data, profile?.role]);

  // Bez dat Esko neodpoví vymyšleným číslem; řekne to a otázku pustí.
  useEffect(() => {
    if (pending?.kind !== "question" || !error || data) return;
    setMessages((current) => [
      ...current,
      {
        from: "esko",
        answer: {
          text: "Čísla se teď nepodařilo načíst. Zkuste to prosím za chvíli.",
          lines: [],
        },
      },
    ]);
    setPending(null);
  }, [pending, error, data]);

  useEffect(() => {
    if (pending?.kind !== "invoice_search" && pending?.kind !== "customer_debt")
      return;
    const controller = new AbortController();
    const query = pending.query;
    const kind = pending.kind;
    void apiFetch<SearchResult>(
      `/api/invoices?q=${encodeURIComponent(query)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        const answer =
          kind === "customer_debt"
            ? eskoCustomerDebtAnswer(
                query,
                result.total,
                result.open_totals,
                profile?.role ?? null,
              )
            : eskoInvoiceSearchAnswer(
                query,
                result.invoices,
                result.total,
                profile?.role ?? null,
              );
        setMessages((current) => [...current, { from: "esko", answer }]);
        setPending(null);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setMessages((current) => [
          ...current,
          {
            from: "esko",
            answer: {
              text: "Faktury se teď nepodařilo prohledat. Zkuste to prosím znovu.",
              lines: [],
            },
          },
        ]);
        setPending(null);
      });
    return () => controller.abort();
  }, [pending, profile?.role]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: messages.length || pending ? listRef.current.scrollHeight : 0 });
  }, [messages, pending, open]);

  useEffect(() => {
    if (!open || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const update = () => {
      const panel = document.getElementById("esko-panel");
      panel?.style.setProperty("--esko-viewport-height", `${viewport.height}px`);
      panel?.style.setProperty("--esko-viewport-top", `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [open]);

  function ask(id: EskoQuestionId) {
    if (pending) return;
    const question = ESKO_QUESTIONS.find((item) => item.id === id);
    if (!question) return;
    setMessages((current) => [
      ...current,
      { from: "user", text: question.label },
    ]);
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
      setMessages((current) => [
        ...current,
        { from: "esko", answer: eskoHelpAnswer() },
      ]);
    } else {
      setPending(intent);
    }
  }

  return (
    <Modal id="esko-panel" modal={false} open={open} onClose={close} labelledBy="esko-heading" className={styles.panel}>
          <header className={styles.head}>
            <Image
              src="/brand/mascot/esko-support.webp"
              alt=""
              width={336}
              height={420}
              sizes="42px"
              className={styles.avatar}
            />
            <span>
              <b id="esko-heading">Esko</b>
              <small>Chat k vašim fakturám</small>
            </span>
            <button
              type="button"
              className={styles.close}
              aria-label="Zavřít chat Esko"
              onClick={close}
            >
              <CloseIcon />
            </button>
          </header>

          <div className={styles.messages} ref={listRef} aria-live="polite">
            <div className={styles.greeting}>
              <strong>S čím vám pomůžu?</strong>
              <p>Zeptejte se na faktury, platby nebo upomínky. Odpovím z aktuálních dat vaší firmy.</p>
            </div>
            {messages.map((message, index) =>
              message.from === "user" ? (
                <p key={index} className={`${styles.msg} ${styles.user}`}>
                  {message.text}
                </p>
              ) : (
                <div key={index} className={`${styles.msg} ${styles.esko}`}>
                  <p>{message.answer.text}</p>
                  {message.answer.lines.length ? (
                    <ul>
                      {message.answer.lines.map((line) => (
                        <li key={line.text}>
                          {line.href ? (
                            <Link
                              href={line.href}
                              onClick={close}
                            >
                              {line.text}
                            </Link>
                          ) : (
                            line.text
                          )}
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

            {/* Návrhy jen pro začátek: jakmile člověk píše nebo se už ptal, ustoupí konverzaci. */}
            {messages.length === 0 && !draft.trim() ? (
              <div className={styles.suggestions}>
                <p className={styles.suggestionsLabel}>Můžete se zeptat</p>
                <div className={styles.chips}>
                  {ESKO_QUESTIONS.slice(0, showAllQuestions ? ESKO_QUESTIONS.length : 4).map((question) => (
                    <button
                      key={question.id}
                      type="button"
                      disabled={Boolean(pending)}
                      onClick={() => ask(question.id)}
                    >
                      <span>{question.label}</span><Icon name="arrow-right" />
                    </button>
                  ))}
                </div>
                <button type="button" className={styles.moreQuestions} aria-expanded={showAllQuestions}
                  onClick={() => setShowAllQuestions(current => !current)}>
                  {showAllQuestions ? "Méně otázek" : "Další otázky"}<Icon name="chevron-down" />
                </button>
              </div>
            ) : null}
          </div>
          <form className={styles.askForm} onSubmit={askText}>
            <label className={styles.srOnly} htmlFor="esko-question">
              Otázka pro Eska
            </label>
            <input
              id="esko-question"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={100}
              placeholder="Zeptejte se Eska…"
              disabled={Boolean(pending)}
            />
            <button type="submit" disabled={Boolean(pending) || !draft.trim()}>
              <span className={styles.srOnly}>Zeptat se</span><Icon name="arrow-right" />
            </button>
          </form>
          <p className={styles.footnote}>
            Esko odpovídá z dat vaší firmy. Platby, faktury ani upomínky samo
            nemění.
          </p>
    </Modal>
  );
}
