"use client";

import { useRef, type ReactNode } from "react";

// Menu „⋯“ u řádku faktury -- stejné jako v detailu faktury
// (invoice-actions-menu), aby tabulka zůstala úzká i vedle bočního panelu.
// Kliknutí na položku menu zavře.
export function NetworkActionsMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details className="invoice-actions-menu network-actions-menu" ref={ref}>
      <summary aria-label={label} title="Další akce">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </summary>
      <div
        className="invoice-actions-menu-popover"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a, button")) ref.current?.removeAttribute("open");
        }}
      >
        {children}
      </div>
    </details>
  );
}
