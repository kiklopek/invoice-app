"use client";

import { useState } from "react";
import useSWR from "swr";
import { Icon } from "@/components/icons";
import { confirmAction } from "@/lib/confirm-action";
import { apiFetch } from "@/lib/api-client";

type Suppression = {
  id: string;
  email: string;
  reason: "bounced" | "complained";
  last_event_at: string;
};

const reasonLabel: Record<Suppression["reason"], string> = {
  bounced: "Nedoručeno",
  complained: "Nahlášeno jako spam",
};
const date = (value: string) =>
  new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium" }).format(new Date(value));

// A bounced/complained address is silently and permanently suppressed from
// every future reminder (see process_resend_delivery_event in supabase/schema.sql)
// with no self-service way to reverse it once the address is actually fixed.
// This panel closes that gap.
export function EmailSuppressionsPanel() {
  const { data, error, isLoading, mutate } = useSWR<{ suppressions: Suppression[] }>(
    "/api/settings/email-suppressions",
  );
  const [removing, setRemoving] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  async function unsuppress(item: Suppression) {
    if (
      !(await confirmAction({
        title: `Odblokovat ${item.email}?`,
        description: "Adresa začne znovu dostávat automatické i ruční upomínky.",
        confirmLabel: "Odblokovat adresu",
      }))
    )
      return;
    setRemoving(item.id);
    setActionError("");
    try {
      await apiFetch("/api/settings/email-suppressions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: item.email }),
      });
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Adresu se nepodařilo odblokovat.");
    } finally {
      setRemoving(null);
    }
  }

  const suppressions = data?.suppressions ?? [];

  return (
    <section className="page-panel data-panel email-suppressions-panel">
      <header className="panel-head">
        <div>
          <h2>Blokované e-mailové adresy</h2>
          <p>
            Adresa se sem zařadí automaticky po nedoručení nebo nahlášení jako spam a
            upomínky na ni přestanou chodit. Po opravě adresy ji zde odblokujte.
          </p>
        </div>
      </header>
      {actionError && <p className="form-error">{actionError}</p>}
      {isLoading ? (
        <p className="page-state">Načítám seznam…</p>
      ) : error ? (
        <p className="page-state error-state">Seznam se nepodařilo načíst.</p>
      ) : suppressions.length ? (
        <div className="large-table email-suppressions-table">
          <table>
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Důvod</th>
                <th>Naposledy</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {suppressions.map((item) => (
                <tr key={item.id}>
                  <td data-label="E-mail">{item.email}</td>
                  <td data-label="Důvod">{reasonLabel[item.reason]}</td>
                  <td data-label="Naposledy">{date(item.last_event_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn secondary compact"
                      disabled={removing === item.id}
                      onClick={() => unsuppress(item)}
                    >
                      <Icon name="check" />
                      {removing === item.id ? "Odblokovávám…" : "Odblokovat"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="page-state">Žádná adresa není momentálně blokovaná.</p>
      )}
    </section>
  );
}
