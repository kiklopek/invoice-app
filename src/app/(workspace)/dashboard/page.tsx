import { DashboardClient } from "./dashboard-client";
import { getCachedRequestIdentity } from "@/lib/auth";
import { loadDashboardPageData } from "@/lib/dashboard-page-data";

export default async function DashboardPage() {
  const identity = await getCachedRequestIdentity();
  const initialData = await loadDashboardPageData(identity);
  return <DashboardClient initialData={initialData} />;
}
