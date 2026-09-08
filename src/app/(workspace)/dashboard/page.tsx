import { DashboardClient } from "./dashboard-client";
import { getCachedRequestIdentity } from "@/lib/auth";
import { loadDashboardPageData } from "@/lib/dashboard-page-data";
import { isDemoMode } from "@/lib/supabase-server";

export default async function DashboardPage() {
  const identity = isDemoMode() ? null : await getCachedRequestIdentity();
  const initialData = await loadDashboardPageData(identity);
  return <DashboardClient initialData={initialData} />;
}
