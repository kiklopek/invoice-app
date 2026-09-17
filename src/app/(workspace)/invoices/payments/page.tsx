import { getCachedRequestIdentity } from "@/lib/auth";
import { loadPaymentsPageData } from "@/lib/payments-page-data";
import { PaymentsClient } from "./payments-client";

export default async function PaymentImportPage() {
  const identity = await getCachedRequestIdentity();
  const initialData = await loadPaymentsPageData(identity);
  return <PaymentsClient initialData={initialData} />;
}
