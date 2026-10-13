import { getCachedRequestIdentity } from "@/lib/auth";
import { loadPartnersPageData } from "@/lib/partners-page-data";
import { PartnersClient } from "./partners-client";

export default async function PartnersPage() {
  const identity = await getCachedRequestIdentity();
  const initialData = await loadPartnersPageData(identity);
  return <PartnersClient initialData={initialData} />;
}
