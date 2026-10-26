"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Shared native-<dialog> primitive. Modal dialogs default to a real
// focus trap and native Escape handling from the browser; support chat can opt
// into a modeless, portalled window that keeps the page usable. This avoids
// each call site hand-rolling its own role="dialog" div + keydown listener
// (which never actually traps focus). Mirrors the technique already used by
// src/lib/confirm-action.ts's imperative confirm dialog.
export function Modal({
  open,
  modal = true,
  id,
  onClose,
  closeDisabled = false,
  labelledBy,
  className = "",
  children,
}: {
  open: boolean;
  modal?: boolean;
  id?: string;
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
      if (modal) ref.current.showModal();
      else ref.current.show();
    }
  }, [open, modal]);

  useEffect(() => {
    if (open) return;
    const trigger = opener.current;
    opener.current = null;
    // Prvek uz nemusi v dokumentu byt (napr. radek tabulky, ktery mezitim
    // zmizel) -- pak se fokus nechava na miste, ne vnucuje nekam jinam.
    if (trigger?.isConnected) trigger.focus();
  }, [open]);

  useEffect(() => {
    if (!open || modal) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || closeDisabled || document.querySelector("dialog:modal")) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [open, modal, closeDisabled, onClose]);

  if (!open) return null;

  const dialog = (
    <dialog
      ref={ref}
      id={id}
      className={`modal ${className}`.trim()}
      aria-labelledby={labelledBy}
      onKeyDown={(event) => {
        if (!modal && event.key === "Escape" && !closeDisabled) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
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
  // Modeless support windows must escape clipping/stacking contexts of page shells.
  return modal ? dialog : createPortal(dialog, document.body);
}
