"use client";

import Link from "next/link";
import useSWR from "swr";
import { plural } from "@/lib/czech-plural";
import type { InvoiceNetworkContext } from "@/lib/partner-network";

// Řádek v detailu vlastní faktury: vidí ji odběratel ve Splatno Síti a má
// k ní připomínky? Chyba načtení se nehlásí -- detail faktury na tom nestojí.
export function InvoiceNetworkNote({ invoiceId }: { invoiceId: string }) {
  const { data } = useSWR<InvoiceNetworkContext | null>(`/api/invoices/${invoiceId}/network`, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  if (!data) return null;
  if (data.state === "not_connected") {
    return (
      <p className="info-section-note network-invoice-note">
        {data.partner.name} používá Splatno. <Link href="/partneri" className="info-section-link">Propojte se</Link> a faktury i platby uvidíte společně.
      </p>
    );
  }
  const openFlags = data.flags.filter((flag) => flag.status === "open");
  return (
    <p className="info-section-note network-invoice-note">
      {data.state === "shared"
        ? `${data.partner.name} je váš partner ve Splatno Síti a tuto fakturu vidí.`
        : `${data.partner.name} je váš partner, tuto starší zaplacenou fakturu ale nevidí.`}
      {openFlags.length ? ` Má k ní ${plural(openFlags.length, "otevřenou připomínku", "otevřené připomínky", "otevřených připomínek")}.` : ""}{" "}
      <Link href={`/partneri/${data.connection_id}`} className="info-section-link">Detail partnera →</Link>
    </p>
  );
}
