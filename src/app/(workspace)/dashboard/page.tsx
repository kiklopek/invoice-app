import { DashboardClient } from "./dashboard-client";
import { getCachedRequestIdentity } from "@/lib/auth";
import { loadDashboardPageData } from "@/lib/dashboard-page-data";

import { dashboardPeriodRange } from "@/lib/dashboard-period";
import { todayInTimeZone } from "@/lib/reminders";

export default async function DashboardPage() {
  const identity = await getCachedRequestIdentity();
  const now = new Date();
  const initialData = await loadDashboardPageData(
    identity,
    dashboardPeriodRange(todayInTimeZone(now), "all"),
  );
  return (
    <DashboardClient initialData={initialData} initialNow={now.toISOString()} />
  );
}
