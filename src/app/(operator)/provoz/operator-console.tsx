"use client";

import { useState } from "react";
import { confirmAction } from "@/lib/confirm-action";
import { findPlan, formatCzk } from "@/lib/plans";

export type OperatorCompany = { id: string; name: string; ico: string | null; email: string | null; data_box_id: string | null; verified_at: string | null; created_at: string; subscription: string };
export type OperatorOrder = { id: string; organization_id: string; order_number: string; variable_symbol: string; plan: string; period: string; gross_halere: number; payment_method: string; status: string; created_at: string; company: string };

const date = (value: string | null) => (value ? new Date(value).toLocaleDateString("cs-CZ") : "—");

// Zásahy provozovatele: každý s poznámkou (audit) a potvrzením s dopadem.
export function OperatorConsole({ operatorEmail, companies, orders }: { operatorEmail: string; companies: OperatorCompany[]; orders: OperatorOrder[] }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, url: string, payload: Record<string, string>, title: string, description: string) {
    const note = (notes[id] ?? "").trim();
    if (note.length < 3) return setMessage("Napište poznámku (jak jste to ověřili / kdy platba přišla).");
    if (!(await confirmAction({ title, description, confirmLabel: "Potvrdit", confirmVariant: "primary" }))) return;
    setBusy(id);
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, note }) }).catch(() => null);
    const body = await response?.json().catch(() => null) as { error?: string; already_paid?: boolean } | null;
    setBusy(null);
    if (!response?.ok) return setMessage(body?.error ?? "Akce se nepodařila.");
    setMessage(body?.already_paid ? "Objednávka už byla zaplacená, nic se nezměnilo." : "Hotovo.");
    window.location.reload();
  }

  const pendingTransfers = orders.filter((order) => order.status === "pending" && order.payment_method === "transfer");
  const unverified = companies.filter((company) => !company.verified_at);
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px", display: "grid", gap: 24 }}>
      <header>
        <h1 style={{ margin: 0 }}>Provoz Splatna</h1>
        <p style={{ margin: "6px 0 0", color: "#5f6b64" }}>Přihlášen(a) jako {operatorEmail}. Každý zásah se zapisuje do auditu.</p>
      </header>
      {message ? <p aria-live="polite" className="success-message">{message}</p> : null}

      <section className="page-panel">
        <h2>Platby převodem čekající na potvrzení ({pendingTransfers.length})</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th align="left">Objednávka</th><th align="left">Firma</th><th align="left">VS</th><th align="left">Částka</th><th align="left">Poznámka</th><th /></tr></thead>
          <tbody>
            {pendingTransfers.map((order) => (
              <tr key={order.id}>
                <td>{order.order_number}<br /><small>{date(order.created_at)}</small></td>
                <td>{order.company}</td>
                <td>{order.variable_symbol}</td>
                <td>{formatCzk(order.gross_halere)}</td>
                <td><input aria-label="Poznámka" placeholder="Připsáno 8. 10., výpis KB" value={notes[order.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [order.id]: event.target.value }))} /></td>
                <td>
                  <button type="button" className="btn primary" disabled={busy === order.id} onClick={() => void act(order.id, "/api/operator/paid", { orderId: order.id },
                    `Potvrdit platbu ${formatCzk(order.gross_halere)} od ${order.company}?`,
                    `Aktivuje se tarif ${findPlan(order.plan)?.name ?? order.plan} ${order.period === "yearly" ? "na 12 měsíců" : "na 1 měsíc"} a zákazníkovi odejde faktura e-mailem.`)}>
                    Platba přišla
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="page-panel">
        <h2>Neověřené firmy ({unverified.length})</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th align="left">Firma</th><th align="left">IČO</th><th align="left">Kontakt</th><th align="left">Předplatné</th><th align="left">Poznámka</th><th /></tr></thead>
          <tbody>
            {unverified.map((company) => (
              <tr key={company.id}>
                <td>{company.name}<br /><small>založeno {date(company.created_at)}</small></td>
                <td>{company.ico}</td>
                <td>{company.email}<br /><small>{company.data_box_id ? `DS ${company.data_box_id}` : "bez DS"}</small></td>
                <td>{company.subscription}</td>
                <td><input aria-label="Poznámka" placeholder="Ověřeno telefonem s jednatelem" value={notes[company.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [company.id]: event.target.value }))} /></td>
                <td>
                  <button type="button" className="btn secondary" disabled={busy === company.id} onClick={() => void act(company.id, "/api/operator/verify", { organizationId: company.id },
                    `Ověřit firmu ${company.name} (IČO ${company.ico})?`,
                    "Firma bude moci kupovat tarify. Ověřujte jen tehdy, když máte jistotu, že účet zakládá někdo z firmy.")}>
                    Ověřit ručně
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="page-panel">
        <h2>Všechny firmy ({companies.length})</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th align="left">Firma</th><th align="left">IČO</th><th align="left">Ověřeno</th><th align="left">Předplatné</th></tr></thead>
          <tbody>
            {companies.map((company) => (
              <tr key={company.id}><td>{company.name}</td><td>{company.ico}</td><td>{date(company.verified_at)}</td><td>{company.subscription}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
