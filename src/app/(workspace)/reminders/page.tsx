import { getCachedRequestIdentity } from "@/lib/auth";
import { loadReminderPageData } from "@/lib/reminder-page-data";
import { RemindersClient } from "./reminders-client";

export default async function RemindersPage() {
  const identity = await getCachedRequestIdentity();
  const initialData = await loadReminderPageData(identity);
  return <RemindersClient initialData={initialData} />;
}
