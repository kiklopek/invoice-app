import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { buildDashboardSummary, type DashboardData } from "@/lib/dashboard-summary";
import { demoInvoices } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/supabase-server";
import { canViewFinancialInsights } from "@/lib/role-access";

const response = (data: DashboardData) => NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });

export async function GET() {
  if (isDemoMode()) return response(buildDashboardSummary(demoInvoices));
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewFinancialInsights(identity.membership.role)) return NextResponse.json({ error: "K firemnímu přehledu nemáte přístup." }, { status: 403 });
  const { data, error } = await identity.service.rpc("dashboard_summary", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
  });
  if (error || !data) return NextResponse.json({ error: "Přehled se nepodařilo načíst. Zkontrolujte databázovou migraci." }, { status: 500 });
  return response(data as DashboardData);
}
