import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import type { DashboardData } from "@/lib/dashboard-summary";
import type { InvoiceReport } from "@/lib/report-query";
import type { DashboardDateRange } from "@/lib/dashboard-period";
import { canViewFinancialInsights } from "@/lib/role-access";

export type DashboardChart = Pick<InvoiceReport, "monthly"> & {
  statuses: Record<"paid" | "pending" | "overdue", Pick<InvoiceReport, "monthly">>;
};

export type DashboardPageData = DashboardData & {
  period?: DashboardDateRange;
  report_from?: string;
  invoice_count?: number;
  paid_invoice_count?: number;
  previous_invoice_count?: number | null;
  currencies?: string[];
  charts?: Record<string, DashboardChart>;
};

export class PageDataError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function loadDashboardPageData(
  identity: RequestIdentity | null,
  range?: DashboardDateRange,
): Promise<DashboardPageData> {
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);
  if (!canViewFinancialInsights(identity.membership.role))
    throw new PageDataError("K firemnímu přehledu nemáte přístup.", 403);

  if (range) {
    const { data, error } = await identity.service.rpc("dashboard_snapshot", {
      target_org: identity.membership.organization_id,
      actor_user: identity.user.id,
      period_from: range.from,
      period_to: range.to,
    });
    if (error || !data)
      throw new PageDataError(
        "Přehled za vybrané období se nepodařilo načíst.",
        500,
      );
    return data as DashboardPageData;
  }

  const { data, error } = await identity.service.rpc("dashboard_summary", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
  });
  if (error || !data)
    throw new PageDataError(
      "Přehled se nepodařilo načíst. Zkuste to prosím znovu za chvíli.",
      500,
    );
  return data as DashboardPageData;
}
