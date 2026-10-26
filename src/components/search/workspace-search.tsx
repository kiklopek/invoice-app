"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Icon, type IconName } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import {
  parseWorkspaceSearch,
  searchAmountHref,
  searchTypeLabels,
  type WorkspaceSearchData,
  type SearchResultType,
} from "@/lib/workspace-search";
import styles from "./workspace-search.module.css";

const resultIcons: Record<SearchResultType, IconName> = {
  invoice: "file-invoice",
  customer: "users",
  payment: "payment-card",
};

export function WorkspaceSearch({
  inputRef,
  className = "",
  inputId = "dashboard-search",
  inlineResults = false,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  className?: string;
  inputId?: string;
  inlineResults?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [response, setResponse] = useState<{
    query: string;
    data: WorkspaceSearchData;
  } | null>(null);
  const [error, setError] = useState<{ query: string; message: string } | null>(
    null,
  );
  const [revision, setRevision] = useState(0);
  const normalized = query.trim();
  const valid = parseWorkspaceSearch(query) !== null;
  const eligible = valid && normalized.length > 0;
  const data = response?.query === normalized ? response.data : null;
  const failure = error?.query === normalized ? error.message : null;
  const results = data?.results ?? [];
  const expanded = open && normalized.length > 0;
  const amountHref = searchAmountHref(query);

  useEffect(() => {
    if (!open || !eligible) return;
    const controller = new AbortController();
    void apiFetch<WorkspaceSearchData>(
      `/api/search?q=${encodeURIComponent(normalized)}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setResponse({ query: normalized, data });
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError({
            query: normalized,
            message:
              cause instanceof Error
                ? cause.message
                : "Vyhledávání se nepodařilo načíst.",
          });
      });
    return () => {
      controller.abort();
    };
  }, [open, eligible, normalized, revision]);

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !formRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);

  useEffect(() => {
    if (selected >= 0)
      document
        .getElementById(`${listId}-${selected}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [selected, listId]);

  function retry() {
    setError(null);
    setRevision((value) => value + 1);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = results[selected >= 0 ? selected : 0];
    if (result) {
      setOpen(false);
      router.push(result.href);
    }
  }

  return (
    <form
      ref={formRef}
      className={`${className} ${styles.form}`}
      role="search"
      onSubmit={submit}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Icon name="search" />
      <label className={styles.srOnly} htmlFor={inputId}>
        Hledat faktury, klienty a platby
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        role="combobox"
        autoComplete="off"
        maxLength={100}
        value={query}
        placeholder="Hledat fakturu, zákazníka nebo částku…"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={
          expanded && results[selected] ? `${listId}-${selected}` : undefined
        }
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setSelected(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            setSelected(-1);
          }
          if (
            (event.key === "ArrowDown" || event.key === "ArrowUp") &&
            results.length
          ) {
            event.preventDefault();
            setOpen(true);
            setSelected((index) =>
              event.key === "ArrowDown"
                ? (index + 1) % results.length
                : index <= 0
                  ? results.length - 1
                  : index - 1,
            );
          }
        }}
      />
      {query.length === 0 ? (
        <kbd className={styles.shortcut} aria-hidden="true">
          ⌘ K
        </kbd>
      ) : null}
      <button className={styles.submit} type="submit" aria-label="Vyhledat">
        <Icon name="arrow-right" />
      </button>
      {expanded ? (
        <div
          className={`${styles.dropdown} ${inlineResults ? styles.inlineDropdown : ""}`}
        >
          <div className={styles.caption}>Výsledky vyhledávání</div>
          <ul
            id={listId}
            role="listbox"
            aria-label="Faktury, klienti a platby"
            className={styles.results}
            aria-busy={eligible && !data && !failure}
          >
            {results.map((result, index) => (
              <li
                key={`${result.type}-${result.id}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={selected === index}
              >
                <Link
                  href={result.href}
                  className={styles.result}
                  data-search-type={result.type}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setOpen(false)}
                >
                  <span className={styles.identity}>
                    <strong title={result.title}>{result.title}</strong>
                    <small title={result.subtitle}>
                      {searchTypeLabels[result.type]} · {result.subtitle}
                    </small>
                  </span>
                  <span
                    className={styles.icon}
                    title={searchTypeLabels[result.type]}
                  >
                    <Icon name={resultIcons[result.type]} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {!valid ? (
            <p className={styles.status} role="status">
              Zadejte platný vyhledávací dotaz.
            </p>
          ) : !eligible ? (
            <p className={styles.status} role="status">
              Začněte psát název, číslo nebo částku.
            </p>
          ) : failure ? (
            <div className={styles.status} role="alert">
              {failure}{" "}
              <button type="button" onClick={retry}>
                Zkusit znovu
              </button>
            </div>
          ) : !data ? (
            <p className={styles.status} role="status">
              Hledám faktury, klienty a platby…
            </p>
          ) : !results.length && !data.unavailable.length ? (
            <p className={styles.status} role="status">
              Pro „{normalized}“ jsme nic nenašli.
            </p>
          ) : null}
          {data?.unavailable.length ? (
            <div className={styles.status} role="status">
              {data.unavailable
                .map((type) => searchTypeLabels[type])
                .join(", ")}
              : výsledky se nepodařilo načíst.{" "}
              <button type="button" onClick={retry}>
                Zkusit znovu
              </button>
            </div>
          ) : null}
          {amountHref ? (
            <Link
              className={styles.amountLink}
              href={amountHref}
              onClick={() => setOpen(false)}
            >
              Vyhledat podle částky: {query.trim()}
            </Link>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
