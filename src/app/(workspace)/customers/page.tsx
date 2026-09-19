import { getCachedRequestIdentity } from "@/lib/auth";
import { loadCustomersPageData } from "@/lib/customers-page-data";
import { CustomersClient } from "./customers-client";

export default async function CustomersPage() {
  const identity = await getCachedRequestIdentity();
  const initialData = await loadCustomersPageData(identity);
  return <CustomersClient initialData={initialData} />;
}
