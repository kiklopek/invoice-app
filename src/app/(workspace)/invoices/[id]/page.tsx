import { notFound } from "next/navigation";
import { getCachedRequestIdentity } from "@/lib/auth";
import { PageDataError } from "@/lib/dashboard-page-data";
import { loadInvoiceDetailPageData } from "@/lib/invoice-detail-page-data";
import { InvoiceDetailClient } from "./invoice-detail-client";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await getCachedRequestIdentity();

  // try/catch obaluje jen načtení dat, ne render: chyby z renderu by se sem
  // stejně nedostaly (React komponentu vykreslí až později) a patří do
  // chybové hranice.
  let initialData;
  try {
    initialData = await loadInvoiceDetailPageData(identity, id);
  } catch (cause) {
    // Neexistující faktura není chyba aplikace, ale špatná adresa. Dřív
    // skončila v obecné chybové hranici („Stránku se nepodařilo načíst“),
    // která uživateli nenaznačila, že jde prostě o neplatný odkaz.
    if (cause instanceof PageDataError && cause.status === 404) notFound();
    throw cause;
  }

  return <InvoiceDetailClient id={id} initialData={initialData} />;
}
