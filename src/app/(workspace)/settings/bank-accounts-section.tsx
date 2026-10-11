"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { confirmAction } from "@/lib/confirm-action";
import { INVOICE_CURRENCIES } from "@/lib/invoice-currency";
import { isValidPaymentAccount } from "@/lib/bank-accounts";

type BankAccount = { id: string; account: string; currency: string; label: string | null };

// Další účty firmy: podle nich se poznají výpisy (bez hlášení „neshoda
// účtu“), jejich měna a účet pro faktury v měně bez hlavního účtu.
export function BankAccountsSection({
  canEdit,
  onMessage,
}: {
  canEdit: boolean;
  onMessage: (text: string, variant: "success" | "error") => void;
}) {
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [account, setAccount] = useState("");
  const [currency, setCurrency] = useState("CZK");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ accounts: BankAccount[] }>("/api/settings/bank-accounts")
      .then((data) => { if (!cancelled) setAccounts(data.accounts); })
      .catch(() => { if (!cancelled) setAccounts([]); });
    return () => { cancelled = true; };
  }, []);

  const invalid = account.trim() !== "" && !isValidPaymentAccount(account);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!account.trim() || invalid) return;
    setBusy(true);
    try {
      const data = await apiFetch<{ account: BankAccount }>("/api/settings/bank-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account, currency, label }),
      });
      setAccounts((current) => [...(current ?? []), data.account]);
      setAccount("");
      setLabel("");
      onMessage("Bankovní účet je přidaný.", "success");
    } catch (cause) {
      onMessage(cause instanceof Error ? cause.message : "Bankovní účet se nepodařilo přidat.", "error");
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
      setAccounts((current) => (current ?? []).filter((entry) => entry.id !== item.id));
      onMessage("Bankovní účet je odebraný.", "success");
    } catch (cause) {
      onMessage(cause instanceof Error ? cause.message : "Bankovní účet se nepodařilo odebrat.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-form" aria-labelledby="company-extra-accounts-title">
      <h3 id="company-extra-accounts-title" className="wide">Další bankovní účty</h3>
      <p className="wide">
        Účty, ze kterých nahráváte výpisy navíc (druhý účet, jiná banka), a účty pro faktury v dalších měnách.
        Výpis z účtu, který tu ani v platebních údajích není, se automaticky nezaúčtuje.
      </p>
      {accounts === null ? <p className="wide">Načítám…</p> : accounts.length === 0 ? (
        <p className="wide">Žádné další účty.</p>
      ) : (
        <ul className="wide">
          {accounts.map((item) => (
            <li key={item.id}>
              <strong>{item.account}</strong> · {item.currency}{item.label ? ` · ${item.label}` : ""}
              {canEdit ? (
                <button type="button" className="btn" disabled={busy} onClick={() => void remove(item)}>Odebrat</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form className="wide" onSubmit={(event) => void add(event)}>
          <label>
            <span>Účet nebo IBAN</span>
            <input value={account} aria-invalid={invalid || undefined} onChange={(event) => setAccount(event.target.value)} placeholder="123-4567890123/0800" />
            {invalid ? <small className="field-error">Číslo účtu neprošlo kontrolní číslicí.</small> : null}
          </label>
          <label>
            <span>Měna</span>
            <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {INVOICE_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <label>
            <span>Popis (nepovinné)</span>
            <input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder="Např. provozní účet" />
          </label>
          <button type="submit" className="btn" disabled={busy || !account.trim() || invalid}>Přidat účet</button>
        </form>
      ) : null}
    </section>
  );
}
