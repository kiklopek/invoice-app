import { getCachedRequestIdentity } from "@/lib/auth";
import { loadReportPageData } from "@/lib/report-page-data";
import { todayInTimeZone } from "@/lib/reminders";
import { isDemoMode } from "@/lib/supabase-server";
import { ReportsClient } from "./reports-client";

export default async function ReportsPage() {
  const today = todayInTimeZone();
  const from = `${today.slice(0, 4)}-01-01`;
  const identity = isDemoMode() ? null : await getCachedRequestIdentity();
  const initialData = await loadReportPageData(identity, { from, to: today, dateBasis: "issue_date", currency: "CZK", status: null, customer: null });
  return <ReportsClient initialData={initialData} initialFrom={from} initialTo={today} initialGeneratedAt={new Date().toISOString()} />;
}
