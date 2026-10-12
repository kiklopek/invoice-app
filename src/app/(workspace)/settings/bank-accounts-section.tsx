"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { confirmAction } from "@/lib/confirm-action";
import { INVOICE_CURRENCIES } from "@/lib/invoice-currency";
import { isValidPaymentAccount } from "@/lib/bank-accounts";
import { ChevronDown } from "@/components/chevron-down";
import styles from "./settings-page.module.css";
import type { SettingsBankAccount } from "@/lib/settings-page-data";

type BankAccount = SettingsBankAccount;

// Další účty firmy: podle nich se poznají výpisy (bez hlášení „neshoda
// účtu“), jejich měna a účet pro faktury v měně bez hlavního účtu.
export function BankAccountsSection({
  canEdit,
  onMessage,
  initialAccounts,
}: {
  canEdit: boolean;
  onMessage: (text: string, variant: "success" | "error") => void;
  initialAccounts?: BankAccount[];
}) {
  const [accounts, setAccounts] = useState<BankAccount[] | null>(initialAccounts ?? null);
  const [account, setAccount] = useState("");
  const [currency, setCurrency] = useState("CZK");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialAccounts !== undefined) {
      setAccounts(initialAccounts);
      return;
    }
    let cancelled = false;
    apiFetch<{ accounts: BankAccount[] }>("/api/settings/bank-accounts")
      .then((data) => {
        if (!cancelled) setAccounts(data.accounts);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [initialAccounts]);

  const invalid = account.trim() !== "" && !isValidPaymentAccount(account);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!account.trim() || invalid) return;
    setBusy(true);
    try {
      const data = await apiFetch<{ account: BankAccount }>(
        "/api/settings/bank-accounts",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ account, currency, label }),
        },
      );
      setAccounts((current) => [...(current ?? []), data.account]);
      setAccount("");
      setLabel("");
      onMessage("Bankovní účet je přidaný.", "success");
    } catch (cause) {
      onMessage(
        cause instanceof Error
          ? cause.message
          : "Bankovní účet se nepodařilo přidat.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: BankAccount) {
    const confirmed = await confirmAction({
      title: "Odebrat bankovní účet?",
      description: `Výpisy z účtu ${item.account} se pak budou hlásit jako z cizího účtu a automaticky se nezaúčtují.`,
      confirmLabel: "Odebrat účet",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await apiFetch("/api/settings/bank-accounts", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      setAccounts((current) =>
        (current ?? []).filter((entry) => entry.id !== item.id),
      );
      onMessage("Bankovní účet je odebraný.", "success");
    } catch (cause) {
      onMessage(
        cause instanceof Error
          ? cause.message
          : "Bankovní účet se nepodařilo odebrat.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className={styles.bankDetails}>
      <summary>
        <span>
          Další bankovní účty{" "}
          <small>
            {accounts?.length
              ? `${accounts.length} evidovaných účtů`
              : "Pro další měny a výpisy"}
          </small>
        </span>
        <ChevronDown />
      </summary>
      <div className={styles.bankContent}>
        <p className={styles.bankDescription}>
          Přidejte účty pro další měny nebo bankovní výpisy. Výpisy z
          neevidovaných účtů se automaticky nezaúčtují.
        </p>
        {accounts === null ? (
          <p className={styles.bankEmpty}>Načítám…</p>
        ) : accounts.length === 0 ? (
          <p className={styles.bankEmpty}>Zatím nemáte žádné další účty.</p>
        ) : (
          <ul className={styles.bankAccounts}>
            {accounts.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.account}</strong>
                  <small>
                    {item.currency}
                    {item.label ? ` · ${item.label}` : ""}
                  </small>
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    className="btn secondary"
                    aria-label={`Odebrat účet ${item.account}`}
                    disabled={busy}
                    onClick={() => void remove(item)}
                  >
                    Odebrat
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <form
            className={styles.bankForm}
            onSubmit={(event) => void add(event)}
          >
            <label className={styles.field}>
              <span>Účet nebo IBAN</span>
              <input
                value={account}
                disabled={busy}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? "extra-account-error" : undefined}
                onChange={(event) => setAccount(event.target.value)}
                placeholder="Číslo účtu / kód banky nebo IBAN"
              />
              {invalid ? (
                <small id="extra-account-error" className="field-error">
                  Číslo účtu neprošlo kontrolní číslicí.
                </small>
              ) : null}
            </label>
            <label className={styles.field}>
              <span>Měna</span>
              <select
                value={currency}
                disabled={busy}
                onChange={(event) => setCurrency(event.target.value)}
              >
                {INVOICE_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Popis (nepovinné)</span>
              <input
                value={label}
                disabled={busy}
                maxLength={80}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Např. provozní účet"
              />
            </label>
            <button
              type="submit"
              className="btn secondary"
              disabled={busy || !account.trim() || invalid}
            >
              {busy ? "Ukládám…" : "Přidat účet"}
            </button>
          </form>
        ) : null}
      </div>
    </details>
  );
}
