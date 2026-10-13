import { getCachedRequestIdentity } from "@/lib/auth";
import { loadReceivedInvoicesPageData } from "@/lib/partners-page-data";
import { ReceivedInvoicesClient } from "./received-invoices-client";

export default async function ReceivedInvoicesPage() {
  const identity = await getCachedRequestIdentity();
  const initialData = await loadReceivedInvoicesPageData(identity);
  return <ReceivedInvoicesClient initialData={initialData} />;
}
