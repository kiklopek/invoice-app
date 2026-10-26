"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const query = "(max-width: 767px)";
function subscribe(callback: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(query);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
export function useSmallMobile() {
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches,
    () => false,
  );
}
const MobileHeaderContext = createContext<{
  target: HTMLDivElement | null;
  setTarget: (element: HTMLDivElement | null) => void;
} | null>(null);
export function MobileHeaderProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  return (
    <MobileHeaderContext.Provider value={{ target, setTarget }}>
      {children}
    </MobileHeaderContext.Provider>
  );
}
export function MobileNotificationSlot() {
  const context = useContext(MobileHeaderContext);
  return (
    <div className="mobile-header-notifications" ref={context?.setTarget} />
  );
}
export function useMobileHeaderTarget() {
  return useContext(MobileHeaderContext)?.target ?? null;
}
