import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import { buildDashboardSummary, type DashboardData } from "@/lib/dashboard-summary";
import { demoInvoices } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/supabase-server";
import { canViewFinancialInsights } from "@/lib/role-access";

export type DashboardPageData = DashboardData;

export class PageDataError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function loadDashboardPageData(identity: RequestIdentity | null): Promise<DashboardPageData> {
  if (isDemoMode()) return buildDashboardSummary(demoInvoices);
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);
  if (!canViewFinancialInsights(identity.membership.role)) throw new PageDataError("K firemnímu přehledu nemáte přístup.", 403);

  const { data, error } = await identity.service.rpc("dashboard_summary", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
  });
  if (error || !data) throw new PageDataError("Přehled se nepodařilo načíst. Zkontrolujte databázovou migraci.", 500);
  return data as DashboardPageData;
}
