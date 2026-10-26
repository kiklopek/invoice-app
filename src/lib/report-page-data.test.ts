import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboard-page-data", () => ({
  PageDataError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));
import { loadReportPageData } from "./report-page-data";
import type { RequestIdentity } from "./auth";

const query = {
  from: "2026-10-01",
  to: "2026-10-23",
  dateBasis: "issue_date" as const,
  currency: "EUR",
  status: "overdue" as const,
  customer: "Firma",
};
function context(organization: string, role = "admin") {
  const rpc = vi
    .fn()
    .mockImplementation((name: string) =>
      Promise.resolve({
        data:
          name === "invoice_report_summary"
            ? { marker: organization }
            : { marker: `payments-${organization}` },
        error: null,
      }),
    );
  const identity = {
    user: { id: `user-${organization}` },
    membership: { role, organization_id: organization },
    service: { rpc },
  } as unknown as RequestIdentity;
  return { rpc, identity };
}
describe("report composite data scopes", () => {
  it("keeps both RPCs isolated for simultaneous different companies", async () => {
    const a = context("a"),
      b = context("b");
    const [reportA, reportB] = await Promise.all([
      loadReportPageData(a.identity, query),
      loadReportPageData(b.identity, query),
    ]);
    expect(reportA).toMatchObject({
      marker: "a",
      payment_reconciliation: { marker: "payments-a" },
    });
    expect(reportB).toMatchObject({
      marker: "b",
      payment_reconciliation: { marker: "payments-b" },
    });
    for (const [name, ctx] of [
      ["a", a],
      ["b", b],
    ] as const) {
      expect(ctx.rpc).toHaveBeenCalledWith(
        "invoice_report_summary",
        expect.objectContaining({
          target_org: name,
          actor_user: `user-${name}`,
          currency_filter: "EUR",
          status_filter: "overdue",
          customer_filter: "Firma",
          date_basis: "issue_date",
        }),
      );
      expect(ctx.rpc).toHaveBeenCalledWith("payment_reconciliation_summary", {
        target_org: name,
        actor_user: `user-${name}`,
        report_from: query.from,
        report_to: query.to,
      });
    }
  });
  it("fails the composite response when one summary fails instead of supplying fake zeroes", async () => {
    const ctx = context("a");
    ctx.rpc.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });
    await expect(loadReportPageData(ctx.identity, query)).rejects.toThrow();
  });
  it("rejects unauthenticated and unauthorized identities before any RPC", async () => {
    await expect(loadReportPageData(null, query)).rejects.toMatchObject({
      status: 401,
    });
    const ctx = context("a", "unknown");
    await expect(loadReportPageData(ctx.identity, query)).rejects.toMatchObject(
      { status: 403 },
    );
    expect(ctx.rpc).not.toHaveBeenCalled();
  });
});
