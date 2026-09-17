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

  useEffect(() => {
    // Mounts fresh each time `open` flips true (see the early return below),
    // so this only ever needs to open a not-yet-open dialog.
    if (open && ref.current && !ref.current.open) ref.current.showModal();
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
