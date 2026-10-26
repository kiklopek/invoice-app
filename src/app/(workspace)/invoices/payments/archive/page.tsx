import { validPaymentHighlight } from "@/lib/workspace-search";
import { getCachedRequestIdentity } from "@/lib/auth";
import { loadPaymentsPageData } from "@/lib/payments-page-data";
import { PaymentsArchiveClient } from "./payments-archive-client";

export default async function PaymentsArchivePage({ searchParams }: { searchParams: Promise<{ highlight?: string | string[] }> }) {
  const highlightPaymentId = validPaymentHighlight((await searchParams).highlight);
  const identity = await getCachedRequestIdentity();
  const initialData = await loadPaymentsPageData(identity, { highlightPaymentId });
  return <PaymentsArchiveClient initialData={initialData} highlightPaymentId={highlightPaymentId} />;
}
