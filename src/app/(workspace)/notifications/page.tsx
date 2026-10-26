import { redirect } from "next/navigation";
import { getCachedRequestIdentity } from "@/lib/auth";
import { NotificationsClient } from "./notifications-client";
export default async function NotificationsPage() {
  if (!await getCachedRequestIdentity()) redirect("/login");
  return <NotificationsClient />;
}
