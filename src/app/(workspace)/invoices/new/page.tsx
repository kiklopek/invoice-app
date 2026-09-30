"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppFrame } from "@/components/layout/app-shell";
import { InvoiceForm } from "@/components/invoice-form";
import { Icon } from "@/components/icons";
import { useInvalidateWorkspaceData } from "@/lib/workspace-cache";
import type { InvoiceInput } from "@/types/invoice";

export default function NewInvoicePage() {
  const router = useRouter();
  const invalidateWorkspaceData = useInvalidateWorkspaceData();
  async function create(input: InvoiceInput) {
    const response = await fetch("/api/invoices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Fakturu se nepodařilo uložit.");
    // Seznam a Přehled sdílí SWR cache; bez invalidace zůstanou na starých číslech.
    void invalidateWorkspaceData();
    router.push(`/invoices/${data.invoice.id}`);
    router.refresh();
  }
  return <AppFrame><div className="manual-invoice-page"><header className="section-header"><div><Link href="/invoices" className="back-link"><Icon name="arrow-left"/>Zpět na faktury</Link><p>RUČNÍ ZADÁNÍ</p><h1>Nová vydaná faktura</h1><span>Zapište fakturu, jejíž úhradu má firma sledovat.</span></div><Link href="/invoices/import" className="btn secondary"><Icon name="upload"/>Raději importovat dokument</Link></header><InvoiceForm onSubmit={create}/></div></AppFrame>;
}
