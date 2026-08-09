"use client";

import { useId, useState, type ReactNode } from "react";

export function MobileDisclosure({
  label,
  children,
  className = "",
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const generatedId = useId();
  const contentId = `mobile-disclosure-${generatedId.replace(/:/g, "")}`;

  return (
    <div className={`mobile-disclosure ${open ? "is-open" : ""} ${className}`.trim()}>
      <button
        type="button"
        className="mobile-disclosure-toggle"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="mobile-disclosure-chevron">⌄</span>
      </button>
      <div id={contentId} className="mobile-disclosure-content">
        {children}
      </div>
    </div>
  );
}
