"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

// Pruh „Režim podpory“: provozovatel je ve firmě zákazníka jako dočasný
// administrátor. Vidí, kde je, do kdy a proč, a může přístup hned ukončit.
export function SupportBanner({ support, companyName }: { support: { expiresAt: string; reason: string } | null; companyName: string }) {
  const [busy, setBusy] = useState(false);
  if (!support) return null;
  const until = new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" }).format(new Date(support.expiresAt));
  async function end() {
    setBusy(true);
    try {
      await apiFetch("/api/operator/support", { method: "DELETE" });
    } finally {
      window.location.assign("/provoz");
    }
  }
  return (
    <div className="form-hint" role="status" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", margin: "12px 16px" }}>
      <span><strong>Režim podpory:</strong> {companyName}, do {until} · {support.reason}</span>
      <button type="button" className="btn compact" disabled={busy} onClick={() => void end()}>Ukončit podporu</button>
    </div>
  );
}
