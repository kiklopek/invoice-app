import { getCachedRequestIdentity } from "@/lib/auth";
import { loadPaymentsPageData } from "@/lib/payments-page-data";
import { PaymentsArchiveClient } from "./payments-archive-client";

export default async function PaymentsArchivePage() {
  const identity = await getCachedRequestIdentity();
  const initialData = await loadPaymentsPageData(identity);
  return <PaymentsArchiveClient initialData={initialData} />;
}
