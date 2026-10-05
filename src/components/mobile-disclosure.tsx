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
        <svg
          aria-hidden="true"
          focusable="false"
          className="mobile-disclosure-chevron"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div id={contentId} className="mobile-disclosure-content">
        {children}
      </div>
    </div>
  );
}
