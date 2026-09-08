import { getCachedRequestIdentity } from "@/lib/auth";
import { loadSettingsPageData } from "@/lib/settings-page-data";
import { isDemoMode } from "@/lib/supabase-server";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const identity = isDemoMode() ? null : await getCachedRequestIdentity();
  const initialData = await loadSettingsPageData(identity);
  return <SettingsClient initialData={initialData} />;
}
