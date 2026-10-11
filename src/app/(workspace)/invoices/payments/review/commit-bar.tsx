"use client";

import { bookButtonLabel, remainingNotice } from "@/lib/payment-review-copy";

/**
 * Spodní lišta kontroly výpisu. Zůstává na obrazovce (sticky) ve stejném
 * sloupci jako seznam, takže uživatel vždy ví, kolik zbývá a co tlačítko
 * udělá. Zablokované tlačítko vždy říká proč.
 */
export function CommitBar({
  remaining,
  bookCount,
  working,
  blockedReason,
  onCommit,
}: {
  remaining: number;
  bookCount: number;
  working: boolean;
  blockedReason: string | null;
  onCommit: () => void;
}) {
  return (
    <div className="payment-commit-bar" role="region" aria-label="Zaúčtování výpisu">
      <div className="payment-commit-copy" aria-live="polite">
        <strong>Zbývá odpovědět: {remaining}</strong>
        <span>{remainingNotice(remaining)}</span>
        {blockedReason && <span id="gpc-confirm-blocked" className="gpc-confirm-blocked" role="status">{blockedReason}</span>}
      </div>
      <button
        type="button"
        className="btn primary import-confirm"
        disabled={working || Boolean(blockedReason)}
        aria-describedby={blockedReason ? "gpc-confirm-blocked" : undefined}
        onClick={onCommit}
      >
        {working ? "Zaúčtovávám…" : bookButtonLabel(bookCount)}
      </button>
    </div>
  );
}
