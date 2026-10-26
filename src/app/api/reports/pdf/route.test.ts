import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  rpc: vi.fn(),
  render: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity }));
vi.mock("@/lib/financial-report-pdf", () => ({
  generateFinancialReport: mocks.render,
}));
import { POST } from "./route";
import { financialReportFixture } from "@/test/financial-report-fixtures";
const input = () => {
  const f = financialReportFixture();
  return { query: f.query, options: f.options };
};
const request = (body: unknown = input(), origin = "http://localhost") =>
  new Request("http://localhost/api/reports/pdf", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({
    membership: { organization_id: "our-org", role: "admin" },
    user: { id: "our-user" },
    service: { rpc: mocks.rpc },
  });
  mocks.rpc.mockResolvedValue({
    data: financialReportFixture().snapshot,
    error: null,
  });
  mocks.render.mockResolvedValue({
    bytes: new Uint8Array([37, 80, 68, 70]),
    pageCount: 12,
  });
});
describe("authorized PDF export", () => {
  it("explains a missing database migration without rendering a blank report", async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:"PGRST202",message:"Could not find public.financial_report_snapshot"}});
    const response=await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("Chybí aktualizace finančních reportů");
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("rejects foreign origins, anonymous users and unknown roles before reading data", async () => {
    expect(
      (await POST(request(input(), "https://foreign.invalid"))).status,
    ).toBe(403);
    mocks.identity.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    mocks.identity.mockResolvedValueOnce({ membership: { role: null } });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses only the authenticated tenant, preserving filters and private PDF headers", async () => {
    const body = {
      ...input(),
      organization_id: "foreign",
      actor_user: "other",
    };
    body.query.customer = "Firma";
    body.query.status = "paid";
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "financial_report_snapshot",
      expect.objectContaining({
        target_org: "our-org",
        actor_user: "our-user",
        customer_filter: "Firma",
        status_filter: "paid",
        date_basis: "issue_date",
      }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-report-pages")).toBe("12");
  });
  it("rejects incomplete datasets and resource limits instead of returning partial reports", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { ...financialReportFixture().snapshot, invoices: [] },
      error: null,
    });
    expect((await POST(request())).status).toBe(503);
    expect(mocks.render).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "report_too_large" },
    });
    expect((await POST(request())).status).toBe(413);
  });
  it("validates options and dates before calling SQL", async () => {
    const body = input();
    body.options.sections = [];
    expect((await POST(request(body))).status).toBe(400);
    body.options.sections = ["revenue"];
    body.query.from = "2026-12-01";
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not expose database failure details", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "private secret schema information" },
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private secret");
  });
});
