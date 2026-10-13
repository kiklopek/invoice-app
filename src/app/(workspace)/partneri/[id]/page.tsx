import { notFound } from "next/navigation";
import { getCachedRequestIdentity } from "@/lib/auth";
import { PageDataError } from "@/lib/dashboard-page-data";
import { loadPartnerDetailPageData } from "@/lib/partners-page-data";
import { PartnerDetailClient } from "./partner-detail-client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const identity = await getCachedRequestIdentity();
  let initialData;
  try {
    initialData = await loadPartnerDetailPageData(identity, id);
  } catch (cause) {
    // Zrušené nebo cizí propojení je špatná adresa, ne chyba aplikace.
    if (cause instanceof PageDataError && cause.status === 404) notFound();
    throw cause;
  }
  return <PartnerDetailClient id={id} initialData={initialData} />;
}
