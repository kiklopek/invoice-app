import { getCachedRequestIdentity } from "@/lib/auth";
import { loadReminderPageData } from "@/lib/reminder-page-data";
import { RemindersClient } from "../../reminders/reminders-client";

export default async function EmailTemplatePage() {
  const identity = await getCachedRequestIdentity();
  const initialData = await loadReminderPageData(identity);
  return <RemindersClient key="templates" initialData={initialData} view="templates" />;
}
