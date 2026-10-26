import type { SVGProps } from "react";
import "./control-icons.css";

export function FilterIcon({ className = "", ...props }: SVGProps<SVGSVGElement>) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    {...props} className={`ui-filter-icon ${className}`.trim()} aria-hidden="true" focusable="false">
    <path d="M4 6h3m4 0h9M4 12h9m4 0h3M4 18h3m4 0h9" />
    <circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="9" cy="18" r="2" />
  </svg>;
}
