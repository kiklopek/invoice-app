"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// Proc tohle existuje: deset klientu melo vlastni stav `error`/`notice`/
// `message` a kazdy ho vykresloval jinde. Dusledky, ktere to melo:
//
// 1. Hlaska se objevila mimo viewport -- uzivatel klikl "Potvrdit uhradu"
//    uprostred dlouhe tabulky a odpoved se vykreslila 800 px nad nim.
// 2. Hlasky nikdy nemizely (nikde zadny setTimeout), takze po chvili nebylo
//    poznat, jestli patri k teto akci nebo k nejake predchozi.
// 3. V 8 z 10 klientu chybel aria-live, takze odecitac obrazovky o vysledku
//    akce nevedel vubec.
// 4. Nejhorsi: chyby ze SWR se useEffectem kopirovaly do stavu `error`
//    a NIKDY se nemazaly -- vterinovy vypadek site trvale schoval tabulku
//    faktur, dokud uzivatel nereloadoval.
//
// Toast resi 1-3 a tim, ze je oddeleny od vykreslovani obsahu, i 4.

export type ToastVariant = "success" | "error" | "info";

export type Toast = {
  id: number;
  variant: ToastVariant;
  message: string;
  /** Doplnujici detail, napr. request_id pro podporu. */
  detail?: string;
};

type ToastContextValue = {
  showToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

// Uspech zmizi sam; chyba ne. Chybu si uzivatel potrebuje precist a casto
// i opsat (request_id), takze ji zavira vyslovne.
const AUTO_DISMISS_MS: Record<ToastVariant, number | null> = {
  success: 5000,
  info: 6000,
  error: null,
};

const VARIANT_LABEL: Record<ToastVariant, string> = {
  success: "Hotovo",
  error: "Chyba",
  info: "Informace",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismissToast = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setToasts(current => {
      // Stejna hlaska dvakrat po sobe (dvojklik, retry) nema delat dve
      // oznameni -- nahradi tu predchozi.
      const withoutDuplicate = current.filter(existing => existing.message !== toast.message);
      return [...withoutDuplicate, { ...toast, id }];
    });
    const timeout = AUTO_DISMISS_MS[toast.variant];
    if (timeout !== null) {
      timers.current.set(id, window.setTimeout(() => dismissToast(id), timeout));
    }
  }, [dismissToast]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Chyby hlasi assertive, aby je odecitac prectl hned; u uspechu by to
          bylo zbytecne vyruseni uprostred prace. */}
      <div className="toast-region" role="region" aria-label="Oznámení">
        <div aria-live="polite" aria-atomic="false">
          {toasts.filter(toast => toast.variant !== "error").map(toast => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
          ))}
        </div>
        <div aria-live="assertive" aria-atomic="false">
          {toasts.filter(toast => toast.variant === "error").map(toast => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  return (
    <div className={`toast toast-${toast.variant}`}>
      <div className="toast-body">
        <strong>{VARIANT_LABEL[toast.variant]}</strong>
        <p>{toast.message}</p>
        {toast.detail && <small>{toast.detail}</small>}
      </div>
      <button type="button" className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Zavřít oznámení">
        ×
      </button>
    </div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast lze použít jen uvnitř <ToastProvider>.");
  }
  return context;
}
