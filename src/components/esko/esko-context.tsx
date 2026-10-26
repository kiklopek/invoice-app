"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import styles from "./esko-assistant.module.css";

type EskoContextValue = {
  open: boolean;
  openAssistant: (trigger: HTMLElement | null) => void;
  closeAssistant: () => void;
};
const EskoContext = createContext<EskoContextValue | null>(null);

export function EskoAssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const openAssistant = useCallback((element: HTMLElement | null) => {
    trigger.current = element;
    element?.focus({ preventScroll: true });
    setOpen(true);
  }, []);
  const closeAssistant = useCallback(() => {
    restoreFocus.current = true;
    setOpen(false);
  }, []);
  useEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
  }, [open]);
  const value = useMemo(() => ({ open, openAssistant, closeAssistant }), [open, openAssistant, closeAssistant]);
  return <EskoContext.Provider value={value}>{children}</EskoContext.Provider>;
}

export function useEskoAssistant() {
  const context = useContext(EskoContext);
  if (!context) throw new Error("EskoAssistantProvider is required");
  return context;
}

export function EskoNavigationButton({ onClick }: { onClick: React.MouseEventHandler<HTMLButtonElement> }) {
  const { open } = useEskoAssistant();
  return <button type="button" className={styles.navigationEntry} onClick={onClick}
    aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? "esko-panel" : undefined}>
    <Image src="/landing/mascot-wave.webp" alt="" width={640} height={554} sizes="48px" />
    <span>Esko</span>
  </button>;
}
