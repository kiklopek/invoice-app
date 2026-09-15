import type { ReactNode } from "react";

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="report-area-background" aria-hidden="true" />
      {children}
    </>
  );
}
