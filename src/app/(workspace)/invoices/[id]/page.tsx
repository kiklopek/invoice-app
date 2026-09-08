import { getCachedRequestIdentity } from "@/lib/auth";
import { loadInvoiceDetailPageData } from "@/lib/invoice-detail-page-data";
import { isDemoMode } from "@/lib/supabase-server";
import { InvoiceDetailClient } from "./invoice-detail-client";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = isDemoMode() ? null : await getCachedRequestIdentity();
  const initialData = await loadInvoiceDetailPageData(identity, id);
  return <InvoiceDetailClient id={id} initialData={initialData} />;
}
