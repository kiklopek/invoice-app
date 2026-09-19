"use client";

import { usePathname } from "next/navigation";

type BackgroundVariant = "overview" | "detail" | "compose" | "import" | "archive";

function backgroundVariant(pathname: string): BackgroundVariant | null {
  if (pathname.startsWith("/invoices/payments")) return null;
  if (pathname === "/invoices") return "overview";
  if (pathname === "/invoices/new") return "compose";
  if (pathname === "/invoices/import") return "import";
  if (pathname === "/invoices/archive") return "archive";
  return "detail";
}

export function InvoiceAreaBackground() {
  const pathname = usePathname();
  const variant = backgroundVariant(pathname);

  if (!variant) return null;

  return <div className={`invoice-area-background ${variant}`} aria-hidden="true" />;
}
