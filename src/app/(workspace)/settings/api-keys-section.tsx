"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { API_KEY_SCOPES, API_KEY_SCOPE_LABELS, type ApiKeySummary } from "@/lib/api-key-policy";
import { confirmAction } from "@/lib/confirm-action";
import styles from "./api-keys-section.module.css";

type Scope = (typeof API_KEY_SCOPES)[number];
const defaultScopes: Scope[] = ["invoices:read", "invoices:write"];
const date = (value: string) => new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function ApiKeysSection({ canEdit }: { canEdit: boolean }) {
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(defaultScopes);
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [observedAt, setObservedAt] = useState(() => Date.now());
  const secretInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const load = useCallback(async () => {
    if (!canEdit) return;
    setError(null);
    try {
      const data = await apiFetch<{ keys: ApiKeySummary[] }>("/api/settings/api-keys");
      if (mounted.current) setKeys(data.keys);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause, "API klíče se nepodařilo načíst."));
    }
  }, [canEdit]);
  useEffect(() => {
    if (!canEdit) return;
    mounted.current = true;
    void load();
    const timer = window.setInterval(() => setObservedAt(Date.now()), 60_000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [canEdit, load]);
  useEffect(() => {
    if (secret) secretInput.current?.focus();
  }, [secret]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit || busy || secret || !name.trim() || !scopes.length) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      // A chosen date includes its whole day in the administrator's local timezone.
      const expiresAt = expiresOn ? new Date(`${expiresOn}T23:59:59`).toISOString() : null;
      const data = await apiFetch<{ key: string; api_key: ApiKeySummary }>("/api/settings/api-keys", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scopes, expires_at: expiresAt }),
      });
      if (!mounted.current) return;
      setKeys((current) => [data.api_key, ...(current ?? [])]);
      setSecret(data.key);
      setCopied(false);
      setName("");
      setExpiresOn("");
      setStatus("API klíč byl vytvořený. Uložte si jej před zavřením.");
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause, "API klíč se nepodařilo vytvořit."));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function revoke(item: ApiKeySummary) {
    if (!canEdit || busy) return;
    if (!(await confirmAction({
      title: "Zrušit API klíč?",
      description: `Napojení „${item.name}“ okamžitě ztratí přístup do Splatna. Zrušený klíč už nepůjde obnovit.`,
      confirmLabel: "Zrušit klíč",
    }))) return;
    if (!mounted.current) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await apiFetch("/api/settings/api-keys", {
        method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id }),
      });
      if (!mounted.current) return;
      setKeys((current) => current?.map((key) => key.id === item.id ? { ...key, revoked_at: new Date().toISOString() } : key) ?? []);
      setSecret(null);
      setStatus(`API klíč „${item.name}“ je zrušený.`);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause, "API klíč se nepodařilo zrušit."));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      if (mounted.current) setCopied(true);
    } catch {
      setError("Kopírování není dostupné. Označte klíč a zkopírujte jej ručně.");
      secretInput.current?.select();
    }
  }

  if (!canEdit) return null;
  return (
    <section className={`page-panel ${styles.panel}`} aria-labelledby="api-keys-title">
      <header className={styles.header}>
        <h2 id="api-keys-title">API a napojení</h2>
        <p>Propojte Splatno s e-shopem nebo účetním systémem. Pro každé napojení vytvořte vlastní klíč s potřebnými oprávněními.</p>
        <p><Link href="/developers">Dokumentace API a příklady volání →</Link></p>
      </header>
      <div className={styles.content}>
        {error ? <p role="alert" className="form-error">{error}</p> : null}
        {status ? <p role="status" className="success-message">{status}</p> : null}
        {secret ? (
          <div className={styles.secret}>
            <strong>Klíč se už znovu nezobrazí</strong>
            <p>Uložte jej do zabezpečeného nastavení napojené aplikace. Klíč umožňuje přístup k firemním datům v rozsahu vybraných oprávnění.</p>
            <input ref={secretInput} aria-label="Nový API klíč" value={secret} readOnly autoComplete="off" spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
            <div className={styles.actions}>
              <button type="button" className="btn primary" onClick={() => void copySecret()}>{copied ? "Zkopírováno" : "Zkopírovat klíč"}</button>
              <button type="button" className="btn secondary" onClick={() => { setSecret(null); setCopied(false); setStatus(null); }}>Klíč mám uložený</button>
            </div>
          </div>
        ) : null}
        {keys === null ? (
          error ? <button type="button" className="btn secondary" onClick={() => void load()}>Načíst znovu</button> : <p role="status">Načítám API klíče…</p>
        ) : keys.length ? (
          <ul className={styles.list}>
            {keys.map((item) => {
              const expired = Boolean(item.expires_at && new Date(item.expires_at).getTime() <= observedAt);
              const state = item.revoked_at ? "Zrušený" : expired ? "Platnost vypršela" : "Aktivní";
              return <li key={item.id}>
                <div className={styles.keyInfo}>
                  <div className={styles.keyHeading}><strong>{item.name}</strong><span className={styles.badge}>{state}</span></div>
                  <code>spl_{item.key_prefix}…</code>
                  <small>{item.scopes.map((scope) => API_KEY_SCOPE_LABELS[scope] ?? scope).join(" · ")}</small>
                  <small>Vytvořený {date(item.created_at)} · {item.last_used_at ? `Naposledy použitý ${date(item.last_used_at)}` : "Zatím nepoužitý"}</small>
                  <small>{item.expires_at ? `Platnost do ${date(item.expires_at)}` : "Bez omezení platnosti"}{item.revoked_at ? ` · Zrušený ${date(item.revoked_at)}` : ""}</small>
                </div>
                {!item.revoked_at ? <button type="button" className="btn secondary" disabled={busy} aria-label={`Zrušit API klíč ${item.name}`} onClick={() => void revoke(item)}>Zrušit klíč</button> : null}
              </li>;
            })}
          </ul>
        ) : <p className={styles.description}>Zatím nemáte žádná API napojení.</p>}
        <form className={styles.form} onSubmit={(event) => void create(event)}>
          <h3>Nový API klíč</h3>
          <fieldset disabled={busy || Boolean(secret) || keys === null}>
            <div className={styles.fields}>
              <label><span>Název napojení</span><input name="api-key-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder="Např. hlavní e-shop" autoComplete="off" /></label>
              <label><span>Platnost do včetně (nepovinné)</span><input name="api-key-expiry" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></label>
            </div>
            <fieldset className={styles.scopes}>
              <legend>Oprávnění napojení</legend>
              {API_KEY_SCOPES.map((scope) => <label key={scope}>
                <input type="checkbox" value={scope} checked={scopes.includes(scope)} onChange={(event) => setScopes((current) => event.target.checked ? [...current, scope] : current.filter((entry) => entry !== scope))} />
                <span>{API_KEY_SCOPE_LABELS[scope]}</span>
              </label>)}
            </fieldset>
            <p className={styles.description}>Povolte jen potřebné operace. Klíč můžete kdykoliv zrušit; změna oprávnění vyžaduje vytvoření nového klíče.</p>
            <button type="submit" className="btn primary" disabled={!name.trim() || !scopes.length}>{busy ? "Vytvářím…" : "Vytvořit API klíč"}</button>
          </fieldset>
        </form>
      </div>
    </section>
  );
}
