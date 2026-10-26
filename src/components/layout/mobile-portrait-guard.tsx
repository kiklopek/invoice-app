"use client";

import { useEffect, useId, useState } from "react";
import { Modal } from "@/components/modal";
import styles from "./mobile-portrait-guard.module.css";

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: "portrait") => Promise<void>;
};

// Use the device screen, not the shrinking visual viewport when a keyboard opens.
export function phoneNeedsPortrait() {
  const phone = navigator.maxTouchPoints > 0
    && window.matchMedia("(pointer: coarse)").matches
    && Math.min(screen.width, screen.height) < 768;
  if (!phone) return false;
  const type = screen.orientation?.type;
  if (type) return type.startsWith("landscape");
  const angle = (window as Window & { orientation?: number }).orientation;
  if (typeof angle === "number") return Math.abs(angle) === 90;
  return screen.width > screen.height;
}

export function MobilePortraitGuard() {
  const [blocked, setBlocked] = useState(false);
  const titleId = useId();
  useEffect(() => {
    let active = true;
    let locked = false;
    const orientation = screen.orientation as LockableOrientation | undefined;
    const update = () => { if (active) setBlocked(phoneNeedsPortrait()); };
    const tryLock = () => {
      update();
      if (!active || !orientation?.lock || document.visibilityState === "hidden"
        || navigator.maxTouchPoints === 0
        || !window.matchMedia("(pointer: coarse)").matches
        || Math.min(screen.width, screen.height) >= 768) return;
      // Browsers may require an installed app or fullscreen. Keep the fallback
      // available instead of forcing fullscreen or changing the current form.
      void orientation.lock("portrait").then(() => {
        if (!active) { orientation.unlock(); return; }
        locked = true;
        update();
      }).catch(() => { update(); });
    };
    tryLock();
    orientation?.addEventListener("change", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("resize", update);
    document.addEventListener("fullscreenchange", tryLock);
    document.addEventListener("visibilitychange", tryLock);
    return () => {
      active = false;
      orientation?.removeEventListener("change", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("fullscreenchange", tryLock);
      document.removeEventListener("visibilitychange", tryLock);
      if (locked) orientation?.unlock();
    };
  }, []);
  return <Modal open={blocked} onClose={() => {}} closeDisabled labelledBy={titleId} className={styles.guard}>
    <div className={styles.message}>
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="18" y="6" width="22" height="44" rx="5"/>
        <path d="M26 11h6M27 44h4M11 14a19 19 0 0 0-5 24m-3-7 3 7 7-3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <h2 id={titleId}>Otočte telefon na výšku</h2>
      <p>Splatno používejte ve svislé poloze. Rozpracované údaje zůstávají zachované.</p>
    </div>
  </Modal>;
}
