"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Shared native-<dialog> primitive so every modal in the app gets a real
// focus trap and native Escape handling for free from the browser, instead of
// each call site hand-rolling its own role="dialog" div + keydown listener
// (which never actually traps focus). Mirrors the technique already used by
// src/lib/confirm-action.ts's imperative confirm dialog.
export function Modal({
  open,
  onClose,
  closeDisabled = false,
  labelledBy,
  className = "",
  children,
}: {
  open: boolean;
  onClose: () => void;
  closeDisabled?: boolean;
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Komponenta se pri zavreni odmountuje (viz early return nize), takze
  // nativni navrat fokusu na spoustec se nestihne -- fokus spadl na <body>
  // a uzivatel klavesnice zacinal tabovat od zacatku stranky. Spoustec si
  // proto pamatujeme sami a fokus mu vracime rucne.
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Mounts fresh each time `open` flips true (see the early return below),
    // so this only ever needs to open a not-yet-open dialog.
    if (open && ref.current && !ref.current.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      ref.current.showModal();
    }
  }, [open]);

  useEffect(() => {
    if (open) return;
    const trigger = opener.current;
    opener.current = null;
    // Prvek uz nemusi v dokumentu byt (napr. radek tabulky, ktery mezitim
    // zmizel) -- pak se fokus nechava na miste, ne vnucuje nekam jinam.
    if (trigger?.isConnected) trigger.focus();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className={`modal ${className}`.trim()}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        if (closeDisabled) event.preventDefault();
      }}
      onClose={onClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
