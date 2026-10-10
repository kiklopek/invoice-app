"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { confirmAction } from "@/lib/confirm-action";

const DURATIONS = [15, 60, 240] as const;

// Vstup podpory do firmy: důvod a doba, potvrzení s rozsahem dopadu
// (kolik administrátorů dostane upozornění), pak do aplikace jako admin.
export function SupportEntry({ organizationId, companyName }: { organizationId: string; companyName: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState<(typeof DURATIONS)[number]>(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (reason.trim().length < 5) return setError("Napište důvod (alespoň 5 znaků).");
    setBusy(true);
    try {
      const preview = await apiFetch<{ company_name: string; admin_count: number }>("/api/operator/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organization_id: organizationId, preview: true }),
      });
      const admins = preview.admin_count;
      const confirmed = await confirmAction({
        title: `Vstoupit do firmy ${preview.company_name} na ${minutes} min jako administrátor?`,
        description: `Upozornění e-mailem ${admins === 0 ? "nedostane nikdo (firma nemá aktivního administrátora)" : `dostane${admins === 1 ? "" : "ou"} ${admins} ${admins === 1 ? "administrátor" : admins < 5 ? "administrátoři" : "administrátorů"}`}. Vstup se zapíše do historie firmy.`,
        confirmLabel: "Vstoupit jako podpora",
        confirmVariant: "primary",
      });
      if (!confirmed) return;
      await apiFetch("/api/operator/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organization_id: organizationId, reason, minutes }),
      });
      window.location.assign("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vstup se nepodařil.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button type="button" className="btn compact" onClick={() => setOpen(true)}>Vstoupit jako podpora</button>;
  return (
    <form onSubmit={(event) => void start(event)} style={{ display: "grid", gap: 6, minWidth: 220 }} aria-label={`Vstup podpory do firmy ${companyName}`}>
      <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} rows={2} placeholder="Důvod (uvidí ho firma)" required />
      <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value) as (typeof DURATIONS)[number])}>
        {DURATIONS.map((value) => <option key={value} value={value}>{value} minut</option>)}
      </select>
      {error ? <small className="field-error">{error}</small> : null}
      <span style={{ display: "flex", gap: 6 }}>
        <button type="submit" className="btn compact primary" disabled={busy}>Pokračovat</button>
        <button type="button" className="btn compact" disabled={busy} onClick={() => setOpen(false)}>Zrušit</button>
      </span>
    </form>
  );
}
