import type { ReactNode } from "react";
import { InvoiceAreaBackground } from "./invoice-area-background";

export default function InvoicesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <InvoiceAreaBackground />
      {children}
    </>
  );
}
