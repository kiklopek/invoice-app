"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { CloseIcon } from "@/components/close-icon";
import { Modal } from "@/components/modal";
import { WorkspaceSearch } from "@/components/search/workspace-search";
import { useSmallMobile } from "./mobile-header-slot";
import styles from "./mobile-header-search.module.css";

export function MobileHeaderSearch() {
  const mobile = useSmallMobile();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    setOpen(false);
  }, [pathname, mobile]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  if (!mobile) return null;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="small-mobile-search-toggle"
        aria-label="Otevřít vyhledávání"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon name="search" />
      </button>
      {createPortal(
        <Modal
          open={open}
          onClose={close}
          labelledBy={`${id}-heading`}
          className={styles.dialog}
        >
          <div
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
            onClick={(event) => {
              if ((event.target as Element).closest("a[href]")) close();
            }}
          >
            <header className={styles.heading}>
              <h2 id={`${id}-heading`}>Vyhledávání</h2>
              <button
                type="button"
                aria-label="Zavřít vyhledávání"
                onClick={close}
              >
                <CloseIcon />
              </button>
            </header>
            <WorkspaceSearch
              inputRef={input}
              inputId={`${id}-input`}
              inlineResults
              className={styles.search}
            />
          </div>
        </Modal>,
        document.body,
      )}
    </>
  );
}
