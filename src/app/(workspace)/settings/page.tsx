import { getCachedRequestIdentity } from "@/lib/auth";
import { loadSettingsPageData } from "@/lib/settings-page-data";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const identity = await getCachedRequestIdentity();
  const initialData = await loadSettingsPageData(identity);
  return <SettingsClient initialData={initialData} />;
}
